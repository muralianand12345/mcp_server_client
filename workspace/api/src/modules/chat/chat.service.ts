import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RagService } from '../rag/rag.service';
import { AgentService } from '../agent/agent.service';
import { ToolAgentService } from '../tool-agent/tool-agent.service';
import { ChatRequestDto } from '../../common/dto/chat-request.dto';
import { ChatResponseDto, TestQueryResponseDto } from '../../common/dto/chat-response.dto';

@Injectable()
export class ChatService {
    private sessions: Map<string, Date> = new Map();

    constructor(
        private ragService: RagService,
        private agentService: AgentService,
        private toolAgentService: ToolAgentService,
    ) { }

    async processQuery(requestDto: ChatRequestDto): Promise<ChatResponseDto> {
        const { message, sessionId = uuidv4() } = requestDto;

        try {
            // Record/update session activity
            this.sessions.set(sessionId, new Date());

            // Step 1: Check if the query is in the RAG context
            console.log('Searching for relevant information...');
            const ragData = await this.ragService.search(message);
            const ragContext = this.ragService.formatRagContext(ragData);

            // Step 2: If RAG context exists, call tool agent
            let toolData: string | null = null;
            if (ragContext) {
                console.log('Executing tools based on context...');
                toolData = await this.toolAgentService.executeTools(message, ragContext);
            }

            // Step 3: Call OpenAI API with RAG + tool data + chat history
            console.log('Generating response...');
            const response = await this.agentService.generateResponse(
                sessionId,
                message,
                ragContext,
                toolData
            );

            return {
                response,
                sessionId,
                timestamp: new Date(),
            };
        } catch (error) {
            console.error(`Error processing query: ${error.message}`);
            return {
                response: 'Sorry, I encountered an error while processing your query.',
                sessionId,
                timestamp: new Date(),
            };
        }
    }

    async testRagQuery(query: string): Promise<TestQueryResponseDto> {
        return this.ragService.testQuery(query);
    }

    clearSession(sessionId: string): void {
        this.agentService.clearSessionHistory(sessionId);
        this.sessions.delete(sessionId);
    }

    // Method to clean up old sessions (could be called by a scheduled task)
    cleanupOldSessions(maxAgeHours: number = 24): void {
        const now = new Date();
        const expiredSessions: string[] = [];

        this.sessions.forEach((timestamp, sessionId) => {
            const ageHours = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
            if (ageHours > maxAgeHours) {
                expiredSessions.push(sessionId);
            }
        });

        expiredSessions.forEach(sessionId => {
            this.clearSession(sessionId);
        });

        console.log(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
}