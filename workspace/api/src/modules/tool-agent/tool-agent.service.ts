import { Injectable } from '@nestjs/common';
import { OpenAIService } from '../../shared/openai/openai.service';
import { ConfigService } from '../../config/config.service';
import { z } from 'zod';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { ToolResponse } from '../../common/interfaces/rag-result.interface';

@Injectable()
export class ToolAgentService {
    private mcpClient: MultiServerMCPClient;
    private outputParser: StructuredOutputParser<any>;

    constructor(
        private openaiService: OpenAIService,
        private configService: ConfigService,
    ) {
        // Initialize output schema
        const outputSchema = z.object({
            urls: z.array(z.string()).describe('List of URLs to be opened.'),
            response: z.string().describe('Response from the tool agent.')
        });
        this.outputParser = StructuredOutputParser.fromZodSchema(outputSchema);

        // Initialize MCP client
        this.mcpClient = new MultiServerMCPClient({
            s3: {
                transport: 'sse',
                url: this.configService.mcpS3Url,
                reconnect: {
                    enabled: true,
                    maxAttempts: 5,
                    delayMs: 2000,
                }
            },
            postgres: {
                transport: 'sse',
                url: this.configService.mcpPostgresUrl,
                reconnect: {
                    enabled: true,
                    maxAttempts: 5,
                    delayMs: 2000,
                }
            }
        });
    }

    private buildSystemPrompt(ragContext: string): string {
        const formatInstructions = this.outputParser.getFormatInstructions();

        let systemPrompt = `You are a tool agent.
        Instructions:
            1. RAG context will be provided to you.
            2. Execute the tools based on the RAG context. 
            3. If the RAG context is not relevant, reply as "No relevant data found in tools" or similar phrases.
            4. Be concise in your reasoning and focus on using the tools effectively.
            5. If the provided Retrieved Data Knowledge has image urls, use the S3 tool to fetch the image urls.

        ${formatInstructions}

        Important: For each image object returned from the S3 bucket, construct the full URL by combining:
        - Base URL: http://localhost:4566
        - Bucket name: xyz-support-images
        - Image key (filename)

        The final URL format should be: http://localhost:4566/xyz-support-images/[image-filename]
        `;

        if (ragContext && ragContext.length > 0) {
            systemPrompt += `\n\n## Retrieved Data Knowledge:\n${ragContext}`;
        }

        systemPrompt += `\n\n## Instructions:\nPlease execute the tools based on the provided data.`;

        return systemPrompt;
    }

    public async executeTools(query: string, ragContext: string): Promise<string> {
        try {
            // If no RAG context, don't bother executing tools
            if (!ragContext || ragContext.length === 0) {
                return JSON.stringify({
                    urls: [],
                    response: "No relevant data found in tools"
                });
            }

            // Configure the agent
            const agentConfig = {
                llm: this.openaiService.getLangChainModel(),
                tools: await this.mcpClient.getTools(),
            };

            // Create the agent
            const agent = createReactAgent(agentConfig);

            // Build the system prompt with RAG context
            const systemPrompt = this.buildSystemPrompt(ragContext);

            // Prepare messages for the agent
            const messages = [
                new SystemMessage(systemPrompt),
                new HumanMessage(query)
            ];

            // Invoke the agent
            const response = await agent.invoke({
                messages: messages
            });

            // Extract and format the tool execution results
            let resultContent = "Tool Execution Results:\n";

            if (response.messages && response.messages.length > 0) {
                // Get the final message which contains the agent's response
                const finalMessage = response.messages[response.messages.length - 1];
                resultContent += finalMessage.content;
            }

            try {
                const parsedResponse = await this.outputParser.parse(resultContent);
                return JSON.stringify(parsedResponse);
            } catch (error) {
                // If parsing fails, return a default format
                return JSON.stringify({
                    urls: [],
                    response: resultContent
                });
            }
        } catch (error) {
            console.error(`Error executing tools: ${error.message}`);
            return JSON.stringify({
                urls: [],
                response: `Error executing tools: ${error.message}`
            });
        }
    }
}