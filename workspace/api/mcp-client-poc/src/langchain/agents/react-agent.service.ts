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
            modelName: this.configService.get('app.openai.modelName', 'gpt-4o'),
            temperature: this.configService.get('app.openai.temperature', 0),
            openAIApiKey: this.configService.get('app.openai.apiKey'),
        });

        this.logger.log(`Initialized with model: ${this.configService.get('app.openai.modelName', 'gpt-4o')}`);
    }

    /**
     * Build a comprehensive system prompt with RAG context and tool usage guidance
     */
    private buildSystemPrompt(ragContext: string, ragResults: RagQueryResults): string {
        // Base system prompt
        let systemPrompt = `You are a helpful assistant with access to both PostgreSQL and S3 data sources.
Your goal is to answer the user's questions accurately using the available data and tools.

`;

        // Add specific tool usage guidance
        systemPrompt += `## Tool Usage Guidelines:
- Use the S3 tools (list_buckets, search_objects, get_object_content) to search and retrieve data from S3 storage
- Use the Postgres tools (query, list_schemas, describe_table) to search and query the database
- Always verify if data exists before trying to retrieve it
- When handling images in S3, use the get_object_content tool with the provided bucket and key

`;

        // Add retrieval results summary
        systemPrompt += `## Retrieved Data Summary:
- Found ${ragResults.combinedResults.length} relevant documents for your query
- S3 Sources: ${ragResults.s3Results.length} documents
- PostgreSQL Sources: ${ragResults.postgresResults.length} records

`;

        // Add the RAG context
        systemPrompt += `${ragContext}

## Your Task:
1. Analyze the retrieved information carefully
2. Use the appropriate tools if you need additional information 
3. Provide a comprehensive and accurate response
4. If the information doesn't fully answer the question, be honest about limitations
5. Always cite your sources (e.g., "Based on the support ticket XYZ-1001...")

When working with S3 images, you MUST first get the image content using the appropriate S3 tool before describing it.`;

        return systemPrompt;
    }

    async processMessage(messages: (HumanMessage | AIMessage)[]) {
        try {
            this.logger.log('Processing message with RAG enhancement');

            const tools = await this.mcpClientService.getTools();

            if (!tools || tools.length === 0) {
                this.logger.error("No tools available from MCP servers");
                throw new Error("No tools available from MCP servers");
            }

            this.logger.log(`Found ${tools.length} tools for processing`);

            // List available tools for debugging
            tools.forEach(tool => {
                this.logger.debug(`Tool available: ${tool.name}`);
            });

            // Get the last user message to use for RAG
            const lastUserMessage = [...messages].reverse().find(
                msg => msg instanceof HumanMessage
            ) as HumanMessage | undefined;

            // Enhanced messages with RAG context if available
            const enhancedMessages = [...messages];

            if (lastUserMessage) {
                // Get RAG context based on the user's query
                const userQuery = lastUserMessage.content as string;
                this.logger.log(`Retrieving RAG context for query: "${userQuery}"`);

                const ragResults = await this.ragService.retrieveRelevantInfo(userQuery);

                if (ragResults && ragResults.combinedResults && ragResults.combinedResults.length > 0) {
                    // Format RAG context for the prompt
                    const ragContext = this.ragService.formatRagContext(ragResults.combinedResults);

                    // Add system message with RAG context
                    if (ragContext) {
                        // Build a comprehensive system prompt with RAG context
                        const systemPrompt = this.buildSystemPrompt(ragContext, ragResults);

                        // Check if there's already a system message and update it
                        const systemMessageIndex = enhancedMessages.findIndex(
                            msg => msg instanceof SystemMessage
                        );

                        if (systemMessageIndex >= 0) {
                            // Update existing system message
                            this.logger.log('Updating existing system message with RAG context');
                            enhancedMessages[systemMessageIndex] = new SystemMessage(systemPrompt);
                        } else {
                            // Add new system message at the beginning
                            this.logger.log('Adding new system message with RAG context');
                            enhancedMessages.unshift(new SystemMessage(systemPrompt));
                        }

                        this.logger.log(`Added RAG context with ${ragResults.combinedResults.length} sources to the conversation`);
                        this.logger.log(`- S3 sources: ${ragResults.s3Results.length}`);
                        this.logger.log(`- PostgreSQL sources: ${ragResults.postgresResults.length}`);
                    } else {
                        this.logger.log('RAG context was empty after formatting');
                    }
                } else {
                    this.logger.log('No relevant RAG results found, proceeding without RAG context');

                    // Add a basic system message to guide the agent even without RAG
                    const baseSystemPrompt = `You are a helpful assistant with access to both PostgreSQL and S3 data sources.
Your goal is to help the user by searching and retrieving information from these sources.

Available tools:
- S3 tools: list_buckets, search_objects, get_object_content
- Postgres tools: query, list_schemas, describe_table

Please use these tools to help answer the user's questions by searching the available data sources.`;

                    const systemMessageIndex = enhancedMessages.findIndex(
                        msg => msg instanceof SystemMessage
                    );

                    if (systemMessageIndex >= 0) {
                        enhancedMessages[systemMessageIndex] = new SystemMessage(baseSystemPrompt);
                    } else {
                        enhancedMessages.unshift(new SystemMessage(baseSystemPrompt));
                    }
                }
            }

            // Build agent with specific configurations for RAG
            const agentConfig = {
                llm: this.model,
                tools,
                maxIterations: 10, // Increase max iterations to allow for more tool use
                returnIntermediateSteps: false // Don't return intermediate steps to save tokens
            };

            this.agent = createReactAgent(agentConfig);
            this.logger.log('Agent created with tools and RAG context');

            // Log the messages being sent to the agent for debugging
            this.logger.debug(`Sending ${enhancedMessages.length} messages to agent`);
            enhancedMessages.forEach((msg, idx) => {
                const type = msg instanceof SystemMessage ? 'system' :
                    msg instanceof HumanMessage ? 'human' : 'ai';
                this.logger.debug(`Message ${idx + 1} (${type}): ${msg.content.toString().substring(0, 100)}...`);
            });

            const result = await this.agent.invoke({ messages: enhancedMessages });

            // Log completion for debugging
            this.logger.log('Agent execution completed successfully');

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