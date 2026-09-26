import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { CitiesQueryDto, ExercisesQueryDto } from './reference.dto';
import { ReferenceService } from './reference.service';

/** Data-driven catalog (docs §7): new sports/exercises are rows, not code. Public and cacheable. */
@ApiTags('reference')
@Public()
@Controller('ref')
export class ReferenceController {
  constructor(private readonly ref: ReferenceService) {}

  @Get('countries')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOkResponse()
  countries() {
    return this.ref.countries();
  }

  @Get('governorates')
  @Header('Cache-Control', 'public, max-age=3600')
  governorates() {
    return this.ref.governorates();
  }

  @Get('cities')
  @Header('Cache-Control', 'public, max-age=3600')
  cities(@Query() q: CitiesQueryDto) {
    return this.ref.cities(q.governorateId);
  }

  @Get('sports')
  @Header('Cache-Control', 'public, max-age=3600')
  sports() {
    return this.ref.sports();
  }

  @Get('metric-types')
  @Header('Cache-Control', 'public, max-age=3600')
  metricTypes() {
    return this.ref.metricTypes();
  }

  @Get('exercises')
  @Header('Cache-Control', 'public, max-age=600')
  exercises(@Query() q: ExercisesQueryDto) {
    return this.ref.exercises(q);
  }
}
