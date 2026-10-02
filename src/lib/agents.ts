/** Agent business rules kept out of the form and the route so both apply the
 *  same thing. */

import { PAYMENT_TERM, type AgentType, type PaymentTerm } from './types';

/** Which Payment Term choices apply to which kind of agent: invoice-style
 *  terms for Individual/Agency, content-style terms for Promoter/Influencer. */
export const PAYMENT_TERM_BY_TYPE: Record<AgentType, readonly PaymentTerm[]> = {
  Individual: ['Net 7', 'Net 15', 'Net 30'],
  Agency: ['Net 7', 'Net 15', 'Net 30'],
  'Promoter/Influencer': ['Per Post', 'Commission', 'Monthly Retainer'],
};

export const paymentTermOptionsFor = (agentType: AgentType): readonly PaymentTerm[] => PAYMENT_TERM_BY_TYPE[agentType];

/** Guards against a payment term left over from before the agent type changed
 *  — e.g. an Agency's "Net 30" surviving a switch to Promoter/Influencer. */
export const paymentTermFitsType = (term: PaymentTerm | null, agentType: AgentType): boolean =>
  term === null || (PAYMENT_TERM_BY_TYPE[agentType] as readonly string[]).includes(term);

export const isPaymentTerm = (value: string): value is PaymentTerm => (PAYMENT_TERM as readonly string[]).includes(value);
