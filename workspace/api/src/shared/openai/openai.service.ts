import { Injectable } from '@nestjs/common';
import { OpenAI } from 'openai';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class OpenAIService {
    private readonly openai: OpenAI;
    private readonly langChainModel: ChatOpenAI;

    constructor(private configService: ConfigService) {
        const apiKey = this.configService.openaiApiKey;

        // Initialize OpenAI client
        this.openai = new OpenAI({
            apiKey,
        });

        // Initialize LangChain ChatOpenAI
        this.langChainModel = new ChatOpenAI({
            openAIApiKey: apiKey,
            modelName: 'gpt-4o',
            temperature: 0.7,
        });
    }

    getClient(): OpenAI {
        return this.openai;
    }

    getLangChainModel(): ChatOpenAI {
        return this.langChainModel;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        try {
            const response = await this.openai.embeddings.create({
                model: 'text-embedding-ada-002',
                input: text,
            });

            return response.data[0].embedding;
        } catch (error) {
            throw new Error(`Failed to generate embedding: ${error.message}`);
        }
    }
}