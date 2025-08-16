import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
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

// PDF processing functions using pdf-parse and pdf-lib
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

export async function POST(request: NextRequest): Promise<NextResponse<FillPDFResponse>> {
  try {
    // Check authentication
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: FillPDFRequest = await request.json();
    const { pdfUrl, userInfo, formType } = body;

    if (!pdfUrl || !userInfo) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields: pdfUrl and userInfo' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { success: false, message: 'Invalid PDF fields extracted' },
        { status: 400 }
      );
    }

    // Generate AI prompt for filling fields
    const prompt = generateFillFieldsPrompt(pdfText, pdfFields, userInfo);

    // Use AI to determine field values
    console.log('Generating field values with AI...');
    const aiResponse = await generateText({
      model: myProvider.languageModel('gpt-4o-mini'),
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
      return NextResponse.json(
        { success: false, message: 'Failed to parse AI response for field values' },
        { status: 500 }
      );
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

    return NextResponse.json({
      success: true,
      filledPdfUrl: blob.url,
      message: 'PDF form filled successfully!',
      fields: sanitizedValues,
    });

  } catch (error) {
    console.error('Error in fill-pdf API:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
