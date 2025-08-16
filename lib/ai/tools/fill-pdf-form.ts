import { tool } from 'ai';
import { z } from 'zod';
import { put } from '@vercel/blob';
import { generateText } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import {
  type FillPDFRequest,
  type FillPDFResponse,
  type PDFField,
  generateFillFieldsPrompt,
  cleanAIResponse,
  downloadPDFFromUrl,
  validatePDFFields,
  sanitizeFieldValues,
} from '@/lib/utils/pdf-processor';

// Simplified PDF processing functions
async function extractPDFText(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    // Use pdf-parse for text extraction (already installed)
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(pdfBuffer);
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (error) {
    console.warn('PDF text extraction failed:', error);
    // Return empty string if text extraction fails
    return '';
  }
}

async function extractPDFFields(pdfBuffer: ArrayBuffer): Promise<PDFField[]> {
  try {
    // Use pdf-lib for form field extraction (similar to PyMuPDF's widget approach)
    const { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } = require('pdf-lib');
    
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();
    const fields: PDFField[] = [];
    
    const formFields = form.getFields();
    
    for (const field of formFields) {
      const fieldName = field.getName();
      let fieldType = 'unknown';
      let maxLength: number | undefined;
      
      // Determine field type (similar to PyMuPDF's field_type_string)
      if (field instanceof PDFTextField) {
        fieldType = 'text';
        maxLength = field.getMaxLength() || undefined;
      } else if (field instanceof PDFCheckBox) {
        fieldType = 'checkbox';
      } else if (field instanceof PDFRadioGroup) {
        fieldType = 'radio';
      } else if (field instanceof PDFDropdown) {
        fieldType = 'dropdown';
      }
      
      fields.push({
        name: fieldName,
        label: fieldName, // PDF forms don't always have separate labels
        type: fieldType,
        maxLength,
      });
    }
    
    return fields;
  } catch (error) {
    throw new Error(`Failed to extract PDF fields: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function fillPDFFields(pdfBuffer: ArrayBuffer, fieldValues: Record<string, string>): Promise<ArrayBuffer> {
  try {
    // Use pdf-lib for form filling (adapted from PyMuPDF approach)
    const { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } = require('pdf-lib');
    
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();
    
    console.log('Filling PDF with values:', fieldValues);
    
    // Iterate through field values and fill the PDF (similar to PyMuPDF's widget approach)
    for (const [fieldName, value] of Object.entries(fieldValues)) {
      try {
        const field = form.getField(fieldName);
        
        // Handle different field types (similar to PyMuPDF's widget.field_value assignment)
        if (field instanceof PDFTextField) {
          field.setText(value);
          console.log(`Set text field '${fieldName}' to: ${value}`);
        } else if (field instanceof PDFCheckBox) {
          // Convert string value to boolean (similar to PyMuPDF approach)
          const shouldCheck = value.toLowerCase() === 'true' || 
                              value.toLowerCase() === 'yes' || 
                              value === '1' ||
                              value.toLowerCase() === 'on' ||
                              value.toLowerCase() === 'checked';
          if (shouldCheck) {
            field.check();
            console.log(`Checked checkbox '${fieldName}'`);
          } else {
            field.uncheck();
            console.log(`Unchecked checkbox '${fieldName}'`);
          }
        } else if (field instanceof PDFRadioGroup) {
          // Try to select the radio option that matches the value
          const options = field.getOptions();
          if (options.includes(value)) {
            field.select(value);
            console.log(`Selected radio '${fieldName}' option: ${value}`);
          } else {
            console.warn(`Radio field '${fieldName}' does not have option '${value}'. Available options:`, options);
          }
        } else if (field instanceof PDFDropdown) {
          // Try to select the dropdown option that matches the value
          const options = field.getOptions();
          if (options.includes(value)) {
            field.select(value);
            console.log(`Selected dropdown '${fieldName}' option: ${value}`);
          } else {
            console.warn(`Dropdown field '${fieldName}' does not have option '${value}'. Available options:`, options);
          }
        } else {
          console.warn(`Unknown field type for '${fieldName}', skipping`);
        }
      } catch (fieldError) {
        console.warn(`Could not fill field '${fieldName}':`, fieldError);
        // Continue with other fields even if one fails (similar to PyMuPDF's error handling)
      }
    }
    
    // Save the filled PDF (similar to PyMuPDF's pdf_document.save())
    const filledPdfBytes = await pdfDoc.save();
    return filledPdfBytes.buffer;
  } catch (error) {
    throw new Error(`Failed to fill PDF fields: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export const fillPdfForm =
  tool({
    description: 'Fill PDF form fields automatically. IMPORTANT: Look through the conversation history to find a line that says "PDF URL for fillPdfForm tool: [URL]" and copy that exact URL. The user will have provided their information in recent messages.',
    inputSchema: z.object({
      pdfUrl: z.string().describe('REQUIRED: The exact URL from "PDF URL for fillPdfForm tool:" line in conversation history'),
      userInfo: z.string().describe('REQUIRED: User information from their recent message (name, address, etc.)'),
      formType: z.string().optional().describe('Optional: w9, tax, etc. - infer from PDF filename'),
    }),
    execute: async (params) => {
      // Debug: Log all parameters received
      console.log('fillPdfForm tool called with params:', JSON.stringify(params, null, 2));
      
      const { pdfUrl, userInfo, formType } = params;
      
      try {
        console.log('Starting PDF form filling process...');
        console.log('PDF URL:', pdfUrl);
        console.log('User Info:', userInfo);
        console.log('Form Type:', formType);
        
        // Validate required parameters
        if (!pdfUrl) {
          throw new Error('pdfUrl parameter is required but was not provided');
        }
        if (!userInfo) {
          throw new Error('userInfo parameter is required but was not provided');
        }

        // Download PDF from URL
        console.log('Downloading PDF from:', pdfUrl);
        const pdfBuffer = await downloadPDFFromUrl(pdfUrl);

        // Extract text and fields from PDF
        console.log('Extracting PDF content...');
        const [pdfText, pdfFields] = await Promise.all([
          extractPDFText(pdfBuffer),
          extractPDFFields(pdfBuffer)
        ]);

        if (!validatePDFFields(pdfFields)) {
          throw new Error('Invalid PDF fields extracted');
        }

        // Generate AI prompt for filling fields
        const prompt = generateFillFieldsPrompt(pdfText, pdfFields, userInfo);

        // Use AI to determine field values
        console.log('Generating field values with AI...');
        const aiResponse = await generateText({
          model: myProvider.languageModel('chat-model'),
          prompt,
          temperature: 0,
        });

        // Parse AI response
        const cleanedResponse = cleanAIResponse(aiResponse.text);
        let fieldValues: Record<string, string>;
        
        try {
          fieldValues = JSON.parse(cleanedResponse);
        } catch (parseError) {
          console.error('Failed to parse AI response:', cleanedResponse);
          throw new Error('Failed to parse AI response for field values');
        }

        // Sanitize field values
        const sanitizedValues = sanitizeFieldValues(fieldValues, pdfFields);

        // Fill PDF with the determined values
        console.log('Filling PDF fields...');
        const filledPdfBuffer = await fillPDFFields(pdfBuffer, sanitizedValues);

        // Upload filled PDF to blob storage
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `filled-form-${formType || 'unknown'}-${timestamp}.pdf`;
        
        const blob = await put(filename, filledPdfBuffer, {
          access: 'public',
          contentType: 'application/pdf',
        });

        console.log('PDF filled successfully:', blob.url);

        return {
          success: true,
          filledPdfUrl: blob.url,
          message: `Form filled successfully! The filled PDF is available at: ${blob.url}`,
          fields: sanitizedValues,
        };
      } catch (error) {
        console.error('Error filling PDF form:', error);
        return {
          success: false,
          message: `Error filling PDF form: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
  });
