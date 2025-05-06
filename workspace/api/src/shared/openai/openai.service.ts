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
        const baseURL = this.configService.openaiBaseUrl;
        const chatOpenAIModel = this.configService.chatOpenAIModel;

        // Initialize OpenAI client
        this.openai = new OpenAI({
            apiKey,
            baseURL,
        });

        // Initialize LangChain ChatOpenAI
        this.langChainModel = new ChatOpenAI({
            openAIApiKey: apiKey,
            modelName: chatOpenAIModel,
            configuration: {
                baseURL: baseURL,
            }
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
            const openaiEmbeddingModel = this.configService.openaiEmbeddingModel;

            const response = await this.openai.embeddings.create({
                model: openaiEmbeddingModel,
                input: text,
            });

            return response.data[0].embedding;
        } catch (error) {
            throw new Error(`Failed to generate embedding: ${error.message}`);
        }
    }
}