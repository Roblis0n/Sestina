import type { StorageDatabase } from "./connection.js";
import { withTransaction, createTransactionView, type StorageTransaction } from "./transaction.js";
import { createProjectRepository, type ProjectRepository } from "./repositories/projects.js";
import { createTaskRepository, type TaskRepository } from "./repositories/tasks.js";
import { createSessionRepository, type HostSessionRepository } from "./repositories/sessions.js";
import { createContractRepository, type ContractRepository } from "./repositories/contracts.js";
import { createCorrectionRepository, type CorrectionRepository } from "./repositories/corrections.js";
import { createEventRepository, type EventRepository } from "./repositories/events.js";
import { createDecisionRepository, type DecisionRepository } from "./repositories/decisions.js";
import { createDecisionTraceRepository, type DecisionTraceRepository } from "./repositories/traces.js";
import { createAssertionRepository, type AssertionRepository } from "./repositories/assertions.js";
import { createEvidenceRepository, type EvidenceRepository } from "./repositories/evidence.js";
import { createConversationRepository, type ConversationRepository } from "./repositories/conversations.js";
import { createCollaborationRepository, type CollaborationRepository } from "./repositories/collaboration.js";
import { createReviewRepository, type ReviewRepository } from "./repositories/reviews.js";
import { createHostStreamRepository, type HostStreamRepository } from "./repositories/host-stream.js";
import { createNotificationRepository, type NotificationRepository } from "./repositories/notifications.js";
import { createUsageRepository, type UsageRepository } from "./repositories/usage.js";
import { createRootBindingRepository, type RootBindingRepository } from "./repositories/root-bindings.js";
import { createSessionAttachmentRepository, type SessionAttachmentRepository } from "./repositories/session-attachments.js";
import { createUnownedActivityRepository, type UnownedActivityRepository } from "./repositories/uowned-activity.js";

/**
 * Typed repository ports bound to one transaction view
 * (docs/22 Task 6). `commit` runs the unit inside a single short write
 * transaction; repository write methods additionally assert they are
 * inside a transaction, so a repo can never accidentally autocommit.
 *
 * Write units are strictly synchronous (docs/17 §3.2): `commit` returns
 * the unit's result directly and rejects Promise-returning units with
 * internal_error. Synchronous nesting becomes a SAVEPOINT whose durability
 * depends on the outer commit.
 */
export interface StorageUnitOfWork {
  projects: ProjectRepository;
  tasks: TaskRepository;
  sessions: HostSessionRepository;
  rootBindings: RootBindingRepository;
  sessionAttachments: SessionAttachmentRepository;
  unownedActivity: UnownedActivityRepository;
  contracts: ContractRepository;
  corrections: CorrectionRepository;
  events: EventRepository;
  decisions: DecisionRepository;
  traces: DecisionTraceRepository;
  assertions: AssertionRepository;
  evidence: EvidenceRepository;
  conversations: ConversationRepository;
  collaboration: CollaborationRepository;
  reviews: ReviewRepository;
  hostStream: HostStreamRepository;
  notifications: NotificationRepository;
  usage: UsageRepository;
  commit<T>(work: (uow: StorageUnitOfWork) => T): T;
}

export function createUnitOfWork(db: StorageDatabase): StorageUnitOfWork {
  const tx: StorageTransaction = createTransactionView(db);
  const uow: StorageUnitOfWork = {
    projects: createProjectRepository(tx),
    tasks: createTaskRepository(tx),
    sessions: createSessionRepository(tx),
    rootBindings: createRootBindingRepository(tx),
    sessionAttachments: createSessionAttachmentRepository(tx),
    unownedActivity: createUnownedActivityRepository(tx),
    contracts: createContractRepository(tx),
    corrections: createCorrectionRepository(tx),
    events: createEventRepository(tx),
    decisions: createDecisionRepository(tx),
    traces: createDecisionTraceRepository(tx),
    assertions: createAssertionRepository(tx),
    evidence: createEvidenceRepository(tx),
    conversations: createConversationRepository(tx),
    collaboration: createCollaborationRepository(tx),
    reviews: createReviewRepository(tx),
    hostStream: createHostStreamRepository(tx),
    notifications: createNotificationRepository(tx),
    usage: createUsageRepository(tx),
    commit(work) {
      // The shared transaction view routes every repository statement
      // through the same connection; nested commits become SAVEPOINTs.
      return withTransaction(db, () => work(uow));
    },
  };
  return uow;
}
