import type { ContractTemplate } from "@sestina/schema";

/**
 * Built-in software contract template (docs/22 Task 9). Template-provided
 * values always carry the "template" source tier when merged, and a template
 * can never create hard boundaries: every boundary here is soft, overridable
 * and owned by the project.
 */
export const SOFTWARE_TEMPLATE: ContractTemplate = {
  schemaVersion: "1.0.0",
  templateId: "sestina/software",
  kind: "software",
  name: "软件开发模板",
  defaults: {
    evidencePolicy: {
      requireSourceForClaims: false,
      minEvidenceLevel: "reference",
      allowUserTestimony: true,
    },
    authority: {
      executorCanChooseMethods: true,
      executorCanProposeScope: true,
      executorCanSelfReview: false,
      overridesRequireUserConfirmation: true,
    },
    budgets: {},
    assumptions: [
      {
        statement: "实现遵循仓库既有代码风格与约束",
        source: "template",
        confidence: 0.6,
        status: "active",
      },
    ],
    boundaries: [
      {
        boundaryId: "tmpl-software-irreversible",
        kind: "action",
        severity: "soft",
        statement: "不可逆操作需先经用户确认",
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
