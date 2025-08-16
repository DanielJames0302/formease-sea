export interface PDFField {
  name: string;
  label: string;
  type: string;
  maxLength?: number;
}

export interface PDFProcessingResult {
  text: string;
  fields: PDFField[];
}

export interface FillPDFRequest {
  pdfUrl: string;
  userInfo: string;
  formType?: string;
}

export interface FillPDFResponse {
  success: boolean;
  filledPdfUrl?: string;
  message: string;
  fields?: Record<string, string>;
}

export function generateFillFieldsPrompt(
  pdfText: string,
  fields: PDFField[],
  userInfo: string
): string {
  return `You are an automated PDF forms filler.
Your job is to fill the following form fields using the provided materials.
Field keys will tell you which values they expect:
${JSON.stringify(fields, null, 2)}

Materials:
- Text extracted from the PDF form, delimited by <>:
<${pdfText}>

- User information provided, delimited by ##:
#${userInfo}#

Instructions:
1. Analyze the form fields and the user information
2. Match the user information to the appropriate form fields
3. Fill each field with the most appropriate value from the user information
4. If a field cannot be filled from the available information, leave it empty
5. Ensure all values fit within the field constraints (max length, type, etc.)

Output a JSON object with key-value pairs where:
- key is the 'name' of the field
- value is the field value you assigned to it

Return only valid JSON, no additional text or formatting.`;
}

export function cleanAIResponse(responseText: string): string {
  let cleaned = responseText.trim();
  
  // Remove markdown formatting if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  
  return cleaned.trim();
}

export async function downloadPDFFromUrl(url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
    }
    return await response.arrayBuffer();
  } catch (error) {
    throw new Error(`Error downloading PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function validatePDFFields(fields: PDFField[]): boolean {
  return Array.isArray(fields) && fields.every(field => 
    typeof field.name === 'string' && 
    typeof field.type === 'string'
  );
}

export function sanitizeFieldValues(fieldValues: Record<string, string>, fields: PDFField[]): Record<string, string> {
  const sanitized: Record<string, string> = {};
  
  for (const [fieldName, value] of Object.entries(fieldValues)) {
    const field = fields.find(f => f.name === fieldName);
    if (field && value) {
      let sanitizedValue = value.toString().trim();
      
      // Respect max length if specified
      if (field.maxLength && sanitizedValue.length > field.maxLength) {
        sanitizedValue = sanitizedValue.substring(0, field.maxLength);
      }
      
      sanitized[fieldName] = sanitizedValue;
    }
  }
  
  return sanitized;
}
