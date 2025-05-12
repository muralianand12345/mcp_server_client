import { IsString, IsNotEmpty } from 'class-validator';

export class ChatInputDto {
    @IsString()
    @IsNotEmpty()
    message: string;
}