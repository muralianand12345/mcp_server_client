import { Injectable } from '@nestjs/common';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { ReactAgentService } from '../../langchain/agents/react-agent.service';

@Injectable()
export class ChatService {
    private chatHistories: Map<string, (HumanMessage | AIMessage)[]> = new Map();

    constructor(private reactAgentService: ReactAgentService) { }

    async processChat(sessionId: string, message: string): Promise<string> {
        // Get or create chat history for this session
        if (!this.chatHistories.has(sessionId)) {
            this.chatHistories.set(sessionId, []);
        }

        const chatHistory = this.chatHistories.get(sessionId)!;

        // Add user message to history
        const userMessage = new HumanMessage(message);
        chatHistory.push(userMessage);

        // Process with agent
        const { response, lastMessage } = await this.reactAgentService.processMessage(chatHistory);

        // Add bot message to history
        chatHistory.push(lastMessage);

        return response;
    }

    clearChatHistory(sessionId: string): void {
        this.chatHistories.delete(sessionId);
    }
}