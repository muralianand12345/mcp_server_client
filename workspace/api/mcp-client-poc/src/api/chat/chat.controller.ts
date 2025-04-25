import { Controller, Post, Get, Body, Headers, Delete, HttpException, HttpStatus } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatInputDto } from './dto/chat-input.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { McpClientService } from '../../langchain/clients/mcp-client.service';

@Controller('chat')
export class ChatController {
    constructor(
        private chatService: ChatService,
        private mcpClientService: McpClientService,
    ) { }

    @Post()
    async chat(
        @Headers('session-id') sessionId: string,
        @Body() chatInputDto: ChatInputDto,
    ): Promise<ChatResponseDto> {
        if (!sessionId) {
            throw new HttpException('Session ID is required', HttpStatus.BAD_REQUEST);
        }

        try {
            const response = await this.chatService.processChat(
                sessionId,
                chatInputDto.message,
            );

            return { response };
        } catch (error) {
            throw new HttpException(
                `Error processing chat: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Delete()
    clearChat(@Headers('session-id') sessionId: string): void {
        if (!sessionId) {
            throw new HttpException('Session ID is required', HttpStatus.BAD_REQUEST);
        }

        this.chatService.clearChatHistory(sessionId);
    }

    @Get('history')
    async getChatHistory(@Headers('session-id') sessionId: string) {
        if (!sessionId) {
            throw new HttpException('Session ID is required', HttpStatus.BAD_REQUEST);
        }

        try {
            return await this.chatService.getChatHistory(sessionId);
        } catch (error) {
            throw new HttpException(
                `Error retrieving chat history: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Get('diagnostics')
    async getDiagnostics() {
        try {
            // Get available tools
            const tools = await this.mcpClientService.getTools();
            const hasRequiredTools = this.mcpClientService.hasRequiredTools();

            // Create a diagnostic report
            const report = {
                status: hasRequiredTools ? 'healthy' : 'unhealthy',
                toolCount: tools.length,
                tools: tools.map(tool => ({
                    name: tool.name,
                    description: tool.description?.substring(0, 100) + (tool.description?.length > 100 ? '...' : '')
                })),
                missingTools: !hasRequiredTools,
                timestamp: new Date().toISOString()
            };

            return report;
        } catch (error) {
            throw new HttpException(
                `Error retrieving diagnostics: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}