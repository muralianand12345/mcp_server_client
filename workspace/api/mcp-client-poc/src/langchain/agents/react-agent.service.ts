import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { McpClientService } from '../clients/mcp-client.service';
import { RagService, RagQueryResults } from '../services/rag.service';

@Injectable()
export class ReactAgentService {
    private agent: any;
    private model: ChatOpenAI;
    private readonly logger = new Logger(ReactAgentService.name);

    constructor(
        private configService: ConfigService,
        private mcpClientService: McpClientService,
        private ragService: RagService,
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

            if (!tools || tools.length === 0) {
                throw new Error("No tools available from MCP servers");
            }

            // Get the last user message to use for RAG
            const lastUserMessage = [...messages].reverse().find(
                msg => msg instanceof HumanMessage
            ) as HumanMessage | undefined;

            // Enhanced messages with RAG context if available
            const enhancedMessages = [...messages];

            if (lastUserMessage) {
                // Get RAG context based on the user's query
                const userQuery = lastUserMessage.content as string;
                const ragResults = await this.ragService.retrieveRelevantInfo(userQuery);

                if (ragResults.combinedResults.length > 0) {
                    // Format RAG context for the prompt
                    const ragContext = this.ragService.formatRagContext(ragResults.combinedResults);

                    // Add system message with RAG context
                    if (ragContext) {
                        // Check if there's already a system message and update it
                        const systemMessageIndex = enhancedMessages.findIndex(
                            msg => msg instanceof SystemMessage
                        );

                        const systemPrompt = `You are a helpful assistant with access to both PostgreSQL and S3 data sources.
                        
Use the following retrieved information to help answer the user's question. 
If the information doesn't fully answer the question, you can use your knowledge 
and the provided tools to search for more information.

${ragContext}

When referring to information from the database or S3, cite the source.`;

                        if (systemMessageIndex >= 0) {
                            // Update existing system message
                            enhancedMessages[systemMessageIndex] = new SystemMessage(systemPrompt);
                        } else {
                            // Add new system message at the beginning
                            enhancedMessages.unshift(new SystemMessage(systemPrompt));
                        }

                        this.logger.log(`Added RAG context with ${ragResults.combinedResults.length} sources to the conversation`);
                        this.logger.log(`- S3 sources: ${ragResults.s3Results.length}`);
                        this.logger.log(`- PostgreSQL sources: ${ragResults.postgresResults.length}`);
                    }
                } else {
                    this.logger.log('No relevant RAG results found');
                }
            }

            this.agent = createReactAgent({ llm: this.model, tools });

            const result = await this.agent.invoke({ messages: enhancedMessages });
            const lastMsg = result.messages[result.messages.length - 1];
            const reply = typeof lastMsg.content === 'string'
                ? lastMsg.content
                : JSON.stringify(lastMsg.content);

            return {
                response: reply,
                lastMessage: new AIMessage(reply)
            };
        } catch (error) {
            this.logger.error(`Agent error: ${error.message}`);
            throw new Error(`Agent error: ${error.message}`);
        }
    }
}