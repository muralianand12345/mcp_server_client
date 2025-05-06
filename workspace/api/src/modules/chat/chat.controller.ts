import { Controller, Post, Body, Delete, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRequestDto } from '../../common/dto/chat-request.dto';
import { ChatResponseDto, TestQueryResponseDto } from '../../common/dto/chat-response.dto';

@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) { }

    @Post()
    @HttpCode(HttpStatus.OK)
    async processChat(
        @Body() chatRequestDto: ChatRequestDto,
        @Headers('session-id') headerSessionId?: string,
    ): Promise<ChatResponseDto> {
        // Use session ID from header if provided, otherwise use the one from the request body
        if (headerSessionId && !chatRequestDto.sessionId) {
            chatRequestDto.sessionId = headerSessionId;
        }

        return this.chatService.processQuery(chatRequestDto);
    }

    @Delete()
    @HttpCode(HttpStatus.NO_CONTENT)
    clearSession(@Headers('session-id') sessionId: string): void {
        if (sessionId) {
            this.chatService.clearSession(sessionId);
        }
    }

    @Post('rag/test-query')
    @HttpCode(HttpStatus.OK)
    async testRagQuery(@Body() body: { query: string }): Promise<TestQueryResponseDto> {
        return this.chatService.testRagQuery(body.query);
    }
}