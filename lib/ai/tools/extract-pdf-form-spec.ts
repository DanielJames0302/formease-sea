import { tool } from 'ai';
import { z } from 'zod';
import { generateText } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import {
  type PDFField,
  downloadPDFFromUrl,
  validatePDFFields,
} from '@/lib/utils/pdf-processor';

/** ---------- Helpers: PDF extraction ---------- */
async function extractPDFText(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(pdfBuffer);
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (error) {
    console.warn('PDF text extraction failed:', error);
    return '';
  }
}

async function extractPDFFields(pdfBuffer: ArrayBuffer): Promise<PDFField[]> {
  try {
    const {
      PDFDocument,
      PDFTextField,
      PDFCheckBox,
      PDFRadioGroup,
      PDFDropdown,
    } = require('pdf-lib');

    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields: PDFField[] = [];

    for (const field of form.getFields()) {
      const fieldName = field.getName();
      let fieldType: PDFField['type'] | 'unknown' = 'unknown';
      let maxLength: number | undefined;

      if (field instanceof PDFTextField) {
        fieldType = 'text';
        // getMaxLength may not exist in some pdf-lib versions
        // @ts-ignore
        maxLength = typeof field.getMaxLength === 'function' ? field.getMaxLength() || undefined : undefined;
      } else if (field instanceof PDFCheckBox) {
        fieldType = 'checkbox';
      } else if (field instanceof PDFRadioGroup) {
        fieldType = 'radio';
      } else if (field instanceof PDFDropdown) {
        fieldType = 'dropdown';
      }

      fields.push({
        name: fieldName,
        label: fieldName,
        type: fieldType as PDFField['type'],
        maxLength,
      });
    }

    return fields;
  } catch (error) {
    throw new Error(
      `Failed to extract PDF fields: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/** ---------- Safe JSON extraction (handles code fences, True/False) ---------- */
function extractJsonObject(text: string): string {
  let t = (text || '').trim();
  // strip markdown fences if present
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  // convert Python booleans to JSON booleans
  t = t.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in model output');
  return t.slice(start, end + 1);
}

/** ---------- Prompt builder: return JSON spec, UI uses natural language ---------- */
function generateQuestionSpecPrompt(
  pdfText: string,
  fields: PDFField[],
  userInfo: string
): string {

  return `You are an automated PDF form assistant.

Goal:
Return a single JSON object describing the questions needed to complete the PDF form.
This JSON will be used to render human-friendly questions in the UI.

STRICT RULES
- Output ONLY valid JSON (no prose, no code fences).
- Use the exact field names provided in "fields" for the "name" property.
- Provide a "question" string in natural language for the user to answer.
- For choice fields (checkbox/radio/dropdown), include an "options" array if deducible from the PDF.
- If you can prefill from userInfo/PDF, include "prefill" with the proposed value and set "needsConfirmation": true.
- Mark "required": true if the field is required by the form; otherwise false or omit if unknown.
- Do not omit fields. If you truly cannot ask anything meaningful for a field, set "question" to "" and "required": false.

INPUT: fields (JSON):
${JSON.stringify(fields, null, 2)}

INPUT: pdf text (between <>):
<${pdfText}>

INPUT: userInfo (between {}):
{${userInfo || ''}}

OUTPUT JSON SHAPE EXAMPLE:
{
  "questions": [
    {
      "name": "topmostSubform[0].Page1[0].f1_01[0]",
      "type": "text",
      "question": "What is your full legal name or the legal entity name?",
      "required": true,
      "prefill": "John A. Smith",
      "needsConfirmation": true
    },
    {
      "name": "topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[5]",
      "type": "checkbox",
      "question": "Check this box if your federal tax classification is LLC.",
      "required": false
    },
    {
      "name": "topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].f1_03[0]",
      "type": "text",
      "question": "If LLC, enter the tax classification (C, S, or P).",
      "required": false,
      "maxLength": 1,
      "options": ["C","S","P"]
    }
  ]
}`;
}

/** ---------- Tool: extract + JSON spec + user-facing text ---------- */
export const extractPdfFormSpec =
  tool({
    description:
      'Extracts fields from a PDF and asks the model for a JSON question spec. The UI can then render natural-language questions from that spec. ' +
      'IMPORTANT: Find "PDF URL for extractPdfFormSpec tool: [URL]" in the conversation and use that exact URL.',
    inputSchema: z.object({
      pdfUrl: z
        .string()
        .describe('REQUIRED: The exact URL from "PDF URL for extractPdfFormSpec tool:"'),
      userInfo: z
        .string()
        .optional()
        .describe('Optional: user-provided info (name, address, etc.) to prefill/confirm'),
    }),
    execute: async (params) => {
      console.log('extractPdfFormSpec tool called with params:', JSON.stringify(params, null, 2));
      const { pdfUrl, userInfo = '' } = params;

      try {
        if (!pdfUrl) throw new Error('pdfUrl parameter is required but was not provided');

        console.log('Downloading PDF from:', pdfUrl);
        const pdfBuffer = await downloadPDFFromUrl(pdfUrl);

        console.log('Extracting PDF text and fields…');
        const [pdfText, pdfFields] = await Promise.all([
          extractPDFText(pdfBuffer),
          extractPDFFields(pdfBuffer),
        ]);

        console.log(pdfText)

        if (!validatePDFFields(pdfFields)) {
          throw new Error('Invalid or empty PDF fields extracted');
        }

        const prompt = generateQuestionSpecPrompt(pdfText, pdfFields, userInfo);

        console.log('Requesting JSON question spec from model…');
        const aiResponse = await generateText({
          model: myProvider.languageModel('chat-model'),
          prompt,
          temperature: 0,
          // If your provider supports strict JSON mode, enable it here (example):
          // response_format: { type: 'json_object' },
        });

        // Parse JSON safely
        const jsonText = extractJsonObject(aiResponse?.text || '');
        const questionSpec = JSON.parse(jsonText) as {
          questions: Array<{
            name: string;
            type?: string;
            question: string;
            required?: boolean;
            options?: string[];
            prefill?: unknown;
            needsConfirmation?: boolean;
            maxLength?: number;
          }>;
        };

        if (!questionSpec?.questions?.length) {
          throw new Error('Model returned no questions');
        }

        // Build a user-facing natural language list for the UI
        const questionsText = questionSpec.questions
          .filter(q => (q.question || '').trim().length > 0)
          .map(q => {
            const base = `• ${q.question.trim()}`;
            const opts = q.options && q.options.length ? ` (Options: ${q.options.join(', ')})` : '';
            const pre = (q.prefill !== undefined && q.prefill !== null && String(q.prefill).length > 0)
              ? ` [We have: ${String(q.prefill)}${q.needsConfirmation ? ' — please confirm' : ''}]`
              : '';
            return `${base}${opts}${pre}`;
          })
          .join('\n');

        console.log('Question spec generated successfully.');
        return {
          success: true,
          message: 'Question spec generated.',
          questionSpec,   // <- JSON you can store/use programmatically
          questionsText,  // <- Natural-language list to show users
          // fields: pdfFields, // (optional) return underlying fields if you want
        };
      } catch (error) {
        console.error('Error generating JSON question spec:', error);
        return {
          success: false,
          message: `Error generating question spec: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
  });
