import type { Request, Response } from 'express'
import type {
  CancellationReport,
  CollectionsReport,
  ExceptionsReport,
  ReturnsReport,
  RevenueReport,
  StockReport,
  VoucherReport,
} from '@ecommerce/shared'
import { parse } from '../../core/middleware/validation.ts'
import { ReportQueryDto, StockReportQueryDto } from './dto/index.ts'
import { XLSX_TYPE } from './report-excel.ts'
import { periodOf } from './report-period.ts'
import type { ReportFile, ReportService } from './report.service.ts'

const periodFrom = (req: Request) => periodOf(parse(ReportQueryDto, req.query))

function sendXlsx(res: Response, { slug, period, file }: ReportFile) {
  res.type(XLSX_TYPE).attachment(`bao-cao-${slug}-${period.from}-${period.to}.xlsx`).send(file)
}

export class ReportController {
  constructor(private readonly service: ReportService) {}

  revenue = async (req: Request, res: Response) => {
    const body: RevenueReport = await this.service.revenue(periodFrom(req))
    res.json(body)
  }

  revenueXlsx = async (req: Request, res: Response) => {
    sendXlsx(res, await this.service.revenueFile(periodFrom(req)))
  }

  collections = async (req: Request, res: Response) => {
    const body: CollectionsReport = await this.service.collections(periodFrom(req))
    res.json(body)
  }

  collectionsXlsx = async (req: Request, res: Response) => {
    sendXlsx(res, await this.service.collectionsFile(periodFrom(req)))
  }

  stock = async (req: Request, res: Response) => {
    const body: StockReport = await this.service.stock(parse(StockReportQueryDto, req.query))
    res.json(body)
  }

  stockXlsx = async (req: Request, res: Response) => {
    sendXlsx(res, await this.service.stockFile(parse(StockReportQueryDto, req.query)))
  }

  vouchers = async (req: Request, res: Response) => {
    const body: VoucherReport = await this.service.vouchers(periodFrom(req))
    res.json(body)
  }

  vouchersXlsx = async (req: Request, res: Response) => {
    sendXlsx(res, await this.service.vouchersFile(periodFrom(req)))
  }

  cancellations = async (req: Request, res: Response) => {
    const body: CancellationReport = await this.service.cancellations(periodFrom(req))
    res.json(body)
  }

  cancellationsXlsx = async (req: Request, res: Response) => {
    sendXlsx(res, await this.service.cancellationsFile(periodFrom(req)))
  }

  returns = async (req: Request, res: Response) => {
    const body: ReturnsReport = await this.service.returns(periodFrom(req))
    res.json(body)
  }

  returnsXlsx = async (req: Request, res: Response) => {
    sendXlsx(res, await this.service.returnsFile(periodFrom(req)))
  }

  exceptions = async (_req: Request, res: Response) => {
    const body: ExceptionsReport = await this.service.exceptions()
    res.json(body)
  }
}
