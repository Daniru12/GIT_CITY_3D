import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { THEMES } from '@gitcity/shared';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { CityService } from './city.service';

@Controller('city')
export class CityController {
  constructor(private readonly city: CityService) {}

  /** Public snapshot of the real, persisted city (developers who have actually joined). */
  @Get()
  snapshot() {
    return this.city.snapshot();
  }

  /** Full project list for one building (same public data as the rooftop board, just not truncated). */
  @Get('building/:id/projects')
  async projects(@Param('id') id: string) {
    return { projects: await this.city.projectsOf(id.slice(0, 64)) };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthedRequest) {
    return { building: await this.city.mine(req.user.id) };
  }

  /** Idempotent: returns the existing building, or allocates a plot server-side. The client never picks the plot. */
  @Post('claim')
  @UseGuards(AuthGuard)
  claim(@Req() req: AuthedRequest) {
    return this.city.ensureBuilding(req.user.id, 'mixed');
  }

  @Get('themes')
  themes() {
    return Object.values(THEMES);
  }
}
