import type { ContractTemplate } from "@sestina/schema";

/**
 * Built-in research contract template (docs/22 Task 9). Template-provided
 * values always carry the "template" source tier when merged, and a template
 * can never create hard boundaries: every boundary here is soft, overridable
 * and owned by the project.
 */
export const RESEARCH_TEMPLATE: ContractTemplate = {
  schemaVersion: "1.0.0",
  templateId: "sestina/research",
  kind: "research",
  name: "研究分析模板",
  defaults: {
    evidencePolicy: {
      requireSourceForClaims: true,
      minEvidenceLevel: "reference",
      allowUserTestimony: true,
    },
    authority: {
      executorCanChooseMethods: true,
      executorCanProposeScope: false,
      executorCanSelfReview: false,
      overridesRequireUserConfirmation: true,
    },
    budgets: {
      maxToolCallsPerTask: 500,
    },
    assumptions: [
      {
        statement: "分析基于可公开获取的资料进行",
        source: "template",
        confidence: 0.6,
        status: "active",
      },
    ],
    boundaries: [
      {
        boundaryId: "tmpl-research-evidence",
        kind: "evidence",
        severity: "soft",
        statement: "报告中引用的数据与观点需注明来源",
        source: { type: "template", confidence: 0.7 },
        owner: "project",
        overridable: true,
        appliesTo: {},
        confidence: 0.7,
        status: "active",
        validFrom: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
};
