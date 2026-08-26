export interface PrivacyDataFlow {
  readonly available: boolean;
  readonly enabled?: boolean;
  readonly automatic: boolean;
  readonly networkUsed?: boolean;
  readonly networkUsedBySestina?: boolean;
  readonly trigger: string;
  readonly recipient: string;
  readonly fields: readonly string[];
  readonly requiresExplicitUserAction: boolean;
  readonly canMutateAuthority: false;
  readonly restoreRequiresConfirmation?: boolean;
}

export interface PrivacyManifest {
  readonly schemaVersion: "1.0.0";
  readonly productMode: "local_research_process_debugger";
  readonly networkDefault: "denied";
  readonly automaticTelemetry: false;
  readonly crashReports: false;
  readonly backgroundContentLogging: false;
  readonly stateDirectory: ".sestina/";
  readonly backupDirectory: ".sestina/backups/";
  readonly automaticUpload: false;
  readonly authorityMutationByExternalModel: false;
  readonly dataFlows: {
    readonly localCoreCli: PrivacyDataFlow;
    readonly codexHost: PrivacyDataFlow;
    readonly byokSemanticProvider: PrivacyDataFlow;
    readonly localModel: PrivacyDataFlow;
    readonly capsuleTransfer: PrivacyDataFlow;
    readonly backupRestore: PrivacyDataFlow;
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const CANONICAL_PRIVACY_MANIFEST: PrivacyManifest = deepFreeze({
  schemaVersion: "1.0.0",
  productMode: "local_research_process_debugger",
  networkDefault: "denied",
  automaticTelemetry: false,
  crashReports: false,
  backgroundContentLogging: false,
  stateDirectory: ".sestina/",
  backupDirectory: ".sestina/backups/",
  automaticUpload: false,
  authorityMutationByExternalModel: false,
  dataFlows: {
    localCoreCli: {
      available: true,
      automatic: false,
      networkUsed: false,
      trigger: "explicit_local_command",
      recipient: "local_project_state_only",
      fields: ["project research state", "Research Brief", "local recovery metadata"],
      requiresExplicitUserAction: true,
      canMutateAuthority: false,
    },
    codexHost: {
      available: true,
      automatic: false,
      networkUsed: true,
      trigger: "explicit_host_connection_or_verification",
      recipient: "user_selected_codex_model_provider",
      fields: ["bounded research context", "project and active Brief identifiers", "current research boundaries"],
      requiresExplicitUserAction: true,
      canMutateAuthority: false,
    },
    byokSemanticProvider: {
      available: true,
      enabled: false,
      automatic: false,
      networkUsed: false,
      trigger: "explicit_research_room_manifest_confirmation",
      recipient: "user_configured_openai_compatible_endpoint",
      fields: [
        "user-selected bounded Research Room context",
        "frozen source, input, criterion, rubric, and state bindings",
        "suggestion or appeal question required for the confirmed assessment",
      ],
      requiresExplicitUserAction: true,
      canMutateAuthority: false,
    },
    localModel: {
      available: false,
      enabled: false,
      automatic: false,
      networkUsed: false,
      trigger: "unavailable",
      recipient: "none",
      fields: [],
      requiresExplicitUserAction: true,
      canMutateAuthority: false,
    },
    capsuleTransfer: {
      available: true,
      automatic: false,
      networkUsedBySestina: false,
      trigger: "explicit_capsule_export_or_import",
      recipient: "user_selected_destination",
      fields: ["bounded portable research projection selected by the user"],
      requiresExplicitUserAction: true,
      canMutateAuthority: false,
    },
    backupRestore: {
      available: true,
      automatic: false,
      networkUsed: false,
      trigger: "explicit_local_backup_or_confirmed_restore",
      recipient: "local_project_backup_directory_only",
      fields: ["local SQLite state", "active Research Brief", "integrity and binding metadata"],
      requiresExplicitUserAction: true,
      canMutateAuthority: false,
      restoreRequiresConfirmation: true,
    },
  },
});

export function getPrivacyManifest(): PrivacyManifest {
  return deepFreeze(structuredClone(CANONICAL_PRIVACY_MANIFEST));
}

export function codexHostNetworkDisclosure(): string {
  const flow = CANONICAL_PRIVACY_MANIFEST.dataFlows.codexHost;
  return `Host verification starts one Codex model call and sends ${flow.fields.join(", ")} to the ${flow.recipient.replaceAll("_", " ")}. Explicit --yes confirmation is required.`;
}
