import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ToriProviderStatus } from '@tradieos/shared';

export abstract class AiProvider {
  abstract status(): ToriProviderStatus;
}

@Injectable()
export class ToriLocalAiProvider implements AiProvider {
  constructor(private readonly config: ConfigService) {}

  status(): ToriProviderStatus {
    const provider = this.config.get<string>('AI_PROVIDER')?.trim() || 'local';
    const model = this.config.get<string>('OPENAI_MODEL')?.trim() || null;
    const hasOpenAiKey = Boolean(
      this.config.get<string>('OPENAI_API_KEY')?.trim(),
    );

    if (provider.toLowerCase() === 'openai') {
      return {
        configured: hasOpenAiKey,
        message: hasOpenAiKey
          ? 'OpenAI provider configured server-side.'
          : 'Tori AI provider is set to OpenAI, but no server API key is configured.',
        mode: 'OPENAI',
        model,
      };
    }

    return {
      configured: true,
      message:
        'Local deterministic Tori mode. No external AI provider is called.',
      mode: 'LOCAL_DETERMINISTIC',
      model: null,
    };
  }
}
