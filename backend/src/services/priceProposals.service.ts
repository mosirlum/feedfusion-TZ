import { withTransaction } from '../db/transaction';
import { HttpError } from '../middleware/errorHandler';
import * as productsRepo from '../db/productsRepo';
import * as proposalsRepo from '../db/priceProposalsRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

/**
 * BR-26/BR-29: owner submissions auto-approve immediately (treated as an
 * approved proposal for audit consistency, per mvp-addendum.md); a sales
 * user's submission sits PENDING and does not touch the active price.
 *
 * Judgment call (flagged at scaffold time, applied here): only one PENDING
 * proposal per product at a time — a second submission while one is still
 * pending is rejected with 409, rather than allowing multiple to queue up.
 */
export async function submitProposal(input: {
  productId: number;
  proposedPrice: number;
  notes?: string;
  proposer: AuthenticatedUser;
}) {
  if (!(input.proposedPrice > 0)) {
    throw new HttpError(400, 'PROPOSED_PRICE_MUST_BE_POSITIVE');
  }

  return withTransaction(async (client) => {
    const product = await productsRepo.findProductByIdForUpdate(input.productId, client);
    if (!product) {
      throw new HttpError(404, 'PRODUCT_NOT_FOUND');
    }

    if (input.proposer.role === 'owner') {
      const proposal = await proposalsRepo.insertProposal(
        {
          productId: input.productId,
          proposedPrice: input.proposedPrice,
          currentActivePrice: product.active_price,
          proposedBy: input.proposer.id,
          status: 'APPROVED',
          reviewedBy: input.proposer.id,
          reviewedAt: new Date(),
          notes: input.notes ?? null,
        },
        client
      );
      const updatedProduct = await productsRepo.setProductActivePrice(
        input.productId,
        input.proposedPrice,
        'OWNER_SET',
        input.proposer.id,
        client
      );
      await writeAuditLog(
        {
          userId: input.proposer.id,
          action: 'PRICE_APPROVED',
          entityType: 'product',
          entityId: input.productId,
          details: { proposalId: proposal.id, from: product.active_price, to: input.proposedPrice, autoApproved: true },
        },
        client
      );
      return { proposal, product: updatedProduct };
    }

    const existingPending = await proposalsRepo.findPendingProposalForProduct(input.productId, client);
    if (existingPending) {
      throw new HttpError(409, 'PENDING_PROPOSAL_ALREADY_EXISTS');
    }

    const proposal = await proposalsRepo.insertProposal(
      {
        productId: input.productId,
        proposedPrice: input.proposedPrice,
        currentActivePrice: product.active_price,
        proposedBy: input.proposer.id,
        status: 'PENDING',
        notes: input.notes ?? null,
      },
      client
    );
    await writeAuditLog(
      {
        userId: input.proposer.id,
        action: 'PRICE_PROPOSED',
        entityType: 'product',
        entityId: input.productId,
        details: { proposalId: proposal.id, from: product.active_price, to: input.proposedPrice },
      },
      client
    );
    return { proposal, product };
  });
}

export function listProposals(status?: string) {
  return proposalsRepo.listProposals(status);
}

export async function approveProposal(proposalId: number, owner: AuthenticatedUser, notes?: string) {
  return withTransaction(async (client) => {
    const proposal = await proposalsRepo.findProposalByIdForUpdate(proposalId, client);
    if (!proposal) {
      throw new HttpError(404, 'PROPOSAL_NOT_FOUND');
    }
    if (proposal.status !== 'PENDING') {
      throw new HttpError(409, 'PROPOSAL_ALREADY_REVIEWED');
    }

    const reviewed = await proposalsRepo.reviewProposal(proposalId, 'APPROVED', owner.id, notes ?? null, client);
    const product = await productsRepo.setProductActivePrice(
      proposal.product_id,
      proposal.proposed_price,
      'APPROVED_PROPOSAL',
      owner.id,
      client
    );
    await writeAuditLog(
      {
        userId: owner.id,
        action: 'PRICE_APPROVED',
        entityType: 'product',
        entityId: proposal.product_id,
        details: { proposalId, from: proposal.current_active_price, to: proposal.proposed_price },
      },
      client
    );
    return { proposal: reviewed, product };
  });
}

export async function rejectProposal(proposalId: number, owner: AuthenticatedUser, notes?: string) {
  return withTransaction(async (client) => {
    const proposal = await proposalsRepo.findProposalByIdForUpdate(proposalId, client);
    if (!proposal) {
      throw new HttpError(404, 'PROPOSAL_NOT_FOUND');
    }
    if (proposal.status !== 'PENDING') {
      throw new HttpError(409, 'PROPOSAL_ALREADY_REVIEWED');
    }

    const reviewed = await proposalsRepo.reviewProposal(proposalId, 'REJECTED', owner.id, notes ?? null, client);
    await writeAuditLog(
      {
        userId: owner.id,
        action: 'PRICE_REJECTED',
        entityType: 'product',
        entityId: proposal.product_id,
        details: { proposalId, proposedPrice: proposal.proposed_price, notes },
      },
      client
    );
    return reviewed;
  });
}
