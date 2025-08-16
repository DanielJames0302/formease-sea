import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { fillPdfForm } from '@/lib/ai/tools/fill-pdf-form';
import { downloadPDFFromUrl } from '@/lib/utils/pdf-processor';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

// Function to preprocess messages and handle PDF files
async function preprocessMessage(message: ChatMessage): Promise<ChatMessage> {
  const processedParts = [];
  
  for (const part of message.parts) {
    if (part.type === 'file' && part.mediaType === 'application/pdf') {
      try {
        // For PDF files, we'll convert them to text and add context
        console.log('Processing PDF file:', part.filename);
        
        // Add a text part that describes the PDF attachment
        processedParts.push({
          type: 'text' as const,
          text: `[PDF Document: ${part.filename}]\n\nI have uploaded a PDF form titled "${part.filename}".\n\nPDF URL for fillPdfForm tool: ${part.url}\n\nPlease help me fill out this form by asking me for the required information, then use the fillPdfForm tool with the PDF URL above to complete it.`,
        });
        
        // Note: We're not including the actual PDF file part since the AI model doesn't support it
        // Instead, we'll pass the PDF URL to the fillPdfForm tool when needed
      } catch (error) {
        console.error('Error processing PDF:', error);
        // Fallback to a simple text description
        processedParts.push({
          type: 'text' as const,
          text: `[PDF Document: ${part.filename}] - Unable to process PDF content, but I can still help you fill out the form.`,
        });
      }
    } else {
      // Keep non-PDF parts as they are
      processedParts.push(part);
    }
  }
  
  return {
    ...message,
    parts: processedParts,
  };
}

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    console.log('Chat API received request:', JSON.stringify(json, null, 2));
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    console.error('Chat API validation error:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const userType: UserType = session.user.type;

    let messageCount = 0;
    try {
      messageCount = await getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 24,
      });
    } catch (error) {
      console.error('Error getting message count, proceeding without rate limit check:', error);
      // Continue without rate limiting if there's a database issue
      messageCount = 0;
    }

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError('rate_limit:chat').toResponse();
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    // Preprocess the user message to handle PDFs
    const processedMessage = await preprocessMessage(message);
    
    // Get existing messages from database and preprocess them
    const messagesFromDb = await getMessagesByChatId({ id });
    const convertedMessages = convertToUIMessages(messagesFromDb);
    
    // Preprocess any existing messages that might contain PDFs
    const preprocessedExistingMessages = await Promise.all(
      convertedMessages.map(async (msg) => {
        if (msg.role === 'user') {
          return await preprocessMessage(msg as ChatMessage);
        }
        return msg;
      })
    );
    
    const uiMessages = [...preprocessedExistingMessages, processedMessage];

    // Debug: Log the final messages being sent to AI
    console.log('Final UI messages for AI:', JSON.stringify(uiMessages, null, 2));

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: processedMessage.parts, // Save the processed parts instead of original
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          // Remove toolChoice parameter as Sea Lion doesn't support "auto" mode
          // and we want tools to be available when explicitly needed
          experimental_activeTools:
            selectedChatModel === 'chat-model-reasoning'
              ? []
              : [
                  'getWeather',
                  'createDocument',
                  'updateDocument',
                  'requestSuggestions',
                  'fillPdfForm',
                ],
          toolChoice: 'auto',
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools: selectedChatModel === 'chat-model-reasoning' ? {} : {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
            fillPdfForm,
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          }),
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        await saveMessages({
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            parts: message.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          })),
        });
      },
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()),
        ),
      );
    } else {
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    }
  } catch (error) {
    console.error('Error in chat API:', error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    // Return a generic error response for non-ChatSDKError exceptions
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
