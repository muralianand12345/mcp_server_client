import { Injectable } from '@nestjs/common';
import { OpenAIService } from '../../shared/openai/openai.service';
import { Message } from '../../common/interfaces/message.interface';

@Injectable()
export class AgentService {
    private chatHistory: Map<string, Array<{ role: 'user' | 'assistant', content: string }>> = new Map();

    constructor(private openaiService: OpenAIService) { }

    // Add a message to the chat history
    public addToHistory(sessionId: string, role: 'user' | 'assistant', content: string): void {
        if (!this.chatHistory.has(sessionId)) {
            this.chatHistory.set(sessionId, []);
        }

        const history = this.chatHistory.get(sessionId) || [];
        history.push({ role, content });

        // Keep chat history at a reasonable size (last 10 messages)
        if (history.length > 10) {
            history.shift();
        }
    }

    // Format chat history for the prompt
    public getSessionHistory(sessionId: string): Array<{ role: 'user' | 'assistant', content: string }> {
        return this.chatHistory.get(sessionId) || [];
    }

    // Clear chat history for a session
    public clearSessionHistory(sessionId: string): void {
        this.chatHistory.delete(sessionId);
    }

    // Build the system prompt with all available context
    private buildSystemPrompt(ragContext: string, toolData: string | null): string {
        let systemPrompt = `You are a helpful assistant.
        Your goal is to answer the user's questions accurately using the available data.
        If the user's question is not in Retrieval RAG, reply with "I don't have enough information to answer that question. Could you ask something else?" or similar phrases.
        Answer in-detail and provide the most relevant information. If the RAG or Tool data has image urls, please add/attach the url link to your response.
    `;

        if (ragContext && ragContext.length > 0) {
            systemPrompt += `\n\n## Retrieved Data Knowledge:\n${ragContext}\n\nThe "metadata.resolution" field is the most important and has the answer to the user's question.`;
        }

        if (toolData && toolData.length > 0) {
            systemPrompt += `\n\n## Tool Data:\n${toolData}`;
        }

        systemPrompt += `\n\n## Instructions:\nPlease answer the user's question based on the provided data. Do not make up information. If you don't know the answer, say "I don't know.". Only answer if the information is in the context.\nIf a image url is given, please add/attach the url link to your response.`;
        return systemPrompt;
    }

    // Generate a response using the OpenAI API
    public async generateResponse(
        sessionId: string,
        query: string,
        ragContext: string,
        toolData: string | null
    ): Promise<string> {
        try {
            const systemPrompt = this.buildSystemPrompt(ragContext, toolData);
            const history = this.getSessionHistory(sessionId);

            // Build the messages array for the OpenAI API
            const messages: Message[] = [];

            // Add system message
            messages.push({
                role: "system",
                content: systemPrompt
            });

            // Add chat history
            for (const msg of history) {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            }

            // Add the current query
            messages.push({
                role: "user",
                content: query
            });

            // Process toolData for images if available
            let toolDataObj: any = null;
            if (toolData) {
                try {
                    toolDataObj = typeof toolData === 'string' ?
                        (toolData.startsWith('{') ? JSON.parse(toolData) : { urls: [], response: toolData })
                        : toolData;

                    const urls = toolDataObj.urls;

                    // Add image URLs to the messages if available
                    if (urls && urls.length > 0) {
                        for (const url of urls) {
                            messages.push({
                                role: "user",
                                content: [
                                    {
                                        type: "image_url",
                                        image_url: {
                                            url,
                                            detail: "high"
                                        }
                                    }
                                ]
                            });
                        }
                    }
                } catch (error) {
                    console.warn(`Could not parse tool data as JSON, using as string: ${error.message}`);
                    toolDataObj = { urls: [], response: toolData };
                }
            }

            const response = await this.openaiService.getClient().chat.completions.create({
                model: "gpt-4o",
                messages: messages as any,
                temperature: 0.7
            });

            const reply = response.choices[0].message.content || "Sorry, I couldn't generate a response.";

            // Add this interaction to chat history
            this.addToHistory(sessionId, 'user', query);
            this.addToHistory(sessionId, 'assistant', reply);

            return reply;
        } catch (error) {
            console.error(`Error generating response: ${error.message}`);
            return "Sorry, I encountered an error while generating a response.";
        }
    }
}