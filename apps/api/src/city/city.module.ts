import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CityController } from './city.controller';
import { CityService } from './city.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [CityController],
  providers: [CityService],
  exports: [CityService],
})
export class CityModule {}
