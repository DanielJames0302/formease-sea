// This file implements the actual PDF processing using pdf-lib
// You'll need to install: npm install pdf-lib pdf-parse

import { PDFDocument, PDFForm, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } from 'pdf-lib';
import { PDFField } from './pdf-processor';

// Note: This is a server-side implementation
// You'll need to install pdf-parse for text extraction
export async function extractPDFTextWithLib(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    // This is a placeholder implementation
    // You'll need to install and use pdf-parse or similar library
    // const pdfParse = require('pdf-parse');
    // const data = await pdfParse(Buffer.from(pdfBuffer));
    // return data.text;
    
    // For now, return a placeholder
    return 'PDF text extraction requires pdf-parse library to be installed';
  } catch (error) {
    throw new Error(`Failed to extract PDF text: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function extractPDFFieldsWithLib(pdfBuffer: ArrayBuffer): Promise<PDFField[]> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();
    const fields: PDFField[] = [];
    
    const formFields = form.getFields();
    
    for (const field of formFields) {
      const fieldName = field.getName();
      let fieldType = 'unknown';
      let maxLength: number | undefined;
      
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

export async function fillPDFFieldsWithLib(
  pdfBuffer: ArrayBuffer, 
  fieldValues: Record<string, string>
): Promise<ArrayBuffer> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();
    
    for (const [fieldName, value] of Object.entries(fieldValues)) {
      try {
        const field = form.getField(fieldName);
        
        if (field instanceof PDFTextField) {
          field.setText(value);
        } else if (field instanceof PDFCheckBox) {
          // Convert string value to boolean
          const shouldCheck = value.toLowerCase() === 'true' || 
                              value.toLowerCase() === 'yes' || 
                              value === '1' ||
                              value.toLowerCase() === 'on';
          if (shouldCheck) {
            field.check();
          } else {
            field.uncheck();
          }
        } else if (field instanceof PDFRadioGroup) {
          // Try to select the radio option that matches the value
          const options = field.getOptions();
          if (options.includes(value)) {
            field.select(value);
          }
        } else if (field instanceof PDFDropdown) {
          // Try to select the dropdown option that matches the value
          const options = field.getOptions();
          if (options.includes(value)) {
            field.select(value);
          }
        }
      } catch (fieldError) {
        console.warn(`Could not fill field ${fieldName}:`, fieldError);
        // Continue with other fields even if one fails
      }
    }
    
    // Flatten the form to prevent further editing (optional)
    // form.flatten();
    
    const bytes = await pdfDoc.save(); // Uint8Array
    // Safely produce a true ArrayBuffer for exactly the bytes of the view
    const buf = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
    return buf; // ← ArrayBuffer
  } catch (error) {
    throw new Error(`Failed to fill PDF fields: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
