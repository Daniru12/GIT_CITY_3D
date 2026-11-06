import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { CityModule } from './city/city.module';
import { HealthController } from './health.controller';
import { InfraModule } from './infra.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      },
    }),
    InfraModule,
    AuthModule,
    CityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
