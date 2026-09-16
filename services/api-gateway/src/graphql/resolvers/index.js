/**
 * Resolver Map
 *
 * Aggregates all query and mutation resolvers into the format
 * expected by makeExecutableSchema.
 */
import { GraphQLJSON } from 'graphql-scalars';
import { DateTimeScalar } from '../schema/scalars.js';

// ─── Query Resolvers ─────────────────────────────────────────────────────────
import { casesResolver }         from './query/cases.resolver.js';
import { workflowsResolver }     from './query/workflows.resolver.js';
import { workflowStepsResolver } from './query/workflowSteps.resolver.js';
import { referralsResolver }     from './query/referrals.resolver.js';
import { assignmentsResolver }   from './query/assignments.resolver.js';
import { auditLogsResolver }     from './query/auditLogs.resolver.js';
import { departmentsResolver }   from './query/departments.resolver.js';
import { metricsResolver }       from './query/metrics.resolver.js';

// ─── Mutation Resolvers ──────────────────────────────────────────────────────
import { createCaseResolver }        from './mutation/createCase.resolver.js';
import { updateCaseResolver }        from './mutation/updateCase.resolver.js';
import { closeCaseResolver }         from './mutation/closeCase.resolver.js';
import { executeTransitionResolver } from './mutation/executeTransition.resolver.js';
import { createReferralResolver }    from './mutation/createReferral.resolver.js';
import { inviteUserResolver }        from './mutation/inviteUser.resolver.js';
import { updateUserResolver }        from './mutation/updateUser.resolver.js';
import { deactivateUserResolver }    from './mutation/deactivateUser.resolver.js';

export const resolvers = {
  // ─── Custom Scalars ───────────────────────────────────────────────────────
  DateTime: DateTimeScalar,
  JSON: GraphQLJSON,

  // ─── Queries ─────────────────────────────────────────────────────────────
  Query: {
    cases:         casesResolver,
    workflows:     workflowsResolver,
    workflowSteps: workflowStepsResolver,
    referrals:     referralsResolver,
    assignments:   assignmentsResolver,
    auditLogs:     auditLogsResolver,
    departments:   departmentsResolver,
    metrics:       metricsResolver,
  },

  // ─── Mutations ───────────────────────────────────────────────────────────
  Mutation: {
    createCase:        createCaseResolver,
    updateCase:        updateCaseResolver,
    closeCase:         closeCaseResolver,
    executeTransition: executeTransitionResolver,
    createReferral:    createReferralResolver,
    inviteUser:        inviteUserResolver,
    updateUser:        updateUserResolver,
    deactivateUser:    deactivateUserResolver,
  },
};
