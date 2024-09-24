
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { userInfo } from 'os';

export const GetUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (data) return request.user[data]
    return request.user;
  },
);

/**
 * creating custom decorator to get user object attached in request object.
 * 1st param data.
 * 2nd param execution context.
 */

