import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { McpClientService } from '../clients/mcp-client.service';

@Injectable()
export class ReactAgentService {
    private agent: any;
    private model: ChatOpenAI;
    private readonly logger = new Logger(ReactAgentService.name);

    constructor(
        private configService: ConfigService,
        private mcpClientService: McpClientService,
    ) {
        this.model = new ChatOpenAI({
            modelName: this.configService.get('app.openai.modelName'),
            temperature: this.configService.get('app.openai.temperature'),
            openAIApiKey: this.configService.get('app.openai.apiKey'),
        });
    }

    async processMessage(messages: (HumanMessage | AIMessage)[]) {
        try {
            const tools = await this.mcpClientService.getTools();
            this.logger.log(`Tools: ${tools}`);
            this.agent = createReactAgent({ llm: this.model, tools });
            
            const result = await this.agent.invoke({ messages });
            const lastMsg = result.messages[result.messages.length - 1];
            const reply = typeof lastMsg.content === 'string'
                ? lastMsg.content
                : JSON.stringify(lastMsg.content);

            return {
                response: reply,
                lastMessage: new AIMessage(reply)
            };
        } catch (error) {
            throw new Error(`Agent error: ${error.message}`);
        }
    }
}