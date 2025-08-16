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
  return `
You are a PDF form-filling engine. Return ONE JSON OBJECT.

STRICT RULES
- Output ONLY valid JSON (no prose, no code fences).
- The top-level must be an OBJECT mapping EXACT field names (keys) -> values.
- Use the syntax: "fieldName": value  (with a colon). Never output "fieldName", value pairs.
- Include all fields from the list; use "" if unknown for text.
- For checkboxes: true/false, not strings.
- For radio/dropdown: one of the exact options or "" if unknown.
- Respect maxLength. Do NOT invent keys.

FIELDS:
${JSON.stringify(fields, null, 2)}

PDF TEXT:
<${pdfText}>

USER INFO:
#${userInfo}#

VALID EXAMPLE:
{
  "topmostSubform[0].Page1[0].f1_01[0]": "Jack",
  "topmostSubform[0].Page1[0].f1_02[0]": "bnb",
  "topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0]": false
}
`
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
