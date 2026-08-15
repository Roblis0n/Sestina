import type { ContractTemplate } from "@sestina/schema";

/**
 * Built-in strategy contract template (docs/22 Task 9). Template-provided
 * values always carry the "template" source tier when merged, and a template
 * can never create hard boundaries: every boundary here is soft, overridable
 * and owned by the project.
 */
export const STRATEGY_TEMPLATE: ContractTemplate = {
  schemaVersion: "1.0.0",
  templateId: "sestina/strategy",
  kind: "strategy",
  name: "技术路线讨论模板",
  defaults: {
    evidencePolicy: {
      requireSourceForClaims: false,
      minEvidenceLevel: "none",
      allowUserTestimony: true,
    },
    authority: {
      executorCanChooseMethods: true,
      executorCanProposeScope: true,
      executorCanSelfReview: true,
      overridesRequireUserConfirmation: true,
    },
    budgets: {},
    assumptions: [
      {
        statement: "路线讨论以当前项目代码与文档为准",
        source: "template",
        confidence: 0.6,
        status: "active",
      },
    ],
    boundaries: [
      {
        boundaryId: "tmpl-strategy-align",
        kind: "process",
        severity: "soft",
        statement: "方向性决策需先与用户对齐",
        source: { type: "template", confidence: 0.8 },
        owner: "project",
        overridable: true,
        appliesTo: {},
        confidence: 0.8,
        status: "active",
        validFrom: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
};
