import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { xai } from '@ai-sdk/xai';
import { google } from '@ai-sdk/google';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';
import { isTestEnvironment } from '../constants';

import { createOpenAI } from '@ai-sdk/openai';

// Create Sea Lion provider using OpenAI-compatible API
const seaLionProvider = createOpenAI({
  name: 'sea-lion',
  apiKey: process.env.SEALION_API_KEY,
  baseURL: "https://api.sea-lion.ai/v1",
});

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': google('gemini-2.0-flash'),
        'chat-model-reasoning': google('gemini-2.0-flash'),
        'title-model': google('gemini-2.0-flash'),
        'artifact-model': google('gemini-2.0-flash'),
      },
      imageModels: {
        'small-model': xai.imageModel('grok-2-image'),
      },
    });
