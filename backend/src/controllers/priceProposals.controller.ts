import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as priceProposalsService from '../services/priceProposals.service';

export async function submitProposalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) throw new HttpError(400, 'INVALID_PRODUCT_ID');
    const { proposedPrice, notes } = req.body ?? {};
    if (typeof proposedPrice !== 'number') throw new HttpError(400, 'PROPOSED_PRICE_REQUIRED');
    const result = await priceProposalsService.submitProposal({
      productId,
      proposedPrice,
      notes,
      proposer: req.user!,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listProposalsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.status(200).json(await priceProposalsService.listProposals(status));
  } catch (err) {
    next(err);
  }
}

export async function approveProposalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PROPOSAL_ID');
    const { notes } = req.body ?? {};
    res.status(200).json(await priceProposalsService.approveProposal(id, req.user!, notes));
  } catch (err) {
    next(err);
  }
}

export async function rejectProposalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PROPOSAL_ID');
    const { notes } = req.body ?? {};
    res.status(200).json(await priceProposalsService.rejectProposal(id, req.user!, notes));
  } catch (err) {
    next(err);
  }
}
