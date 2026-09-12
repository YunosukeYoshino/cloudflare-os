export type ProbeWorkspaceConfiguratorValues = {
  confirmed?: string | null;
};

export interface ProbeWorkspaceConfiguratorRpc {
  /** Returns `probe://workspace`. */
  resourceUrl(): Promise<string>;
  /** Connected Probe origin and signed-in email, for the confirmation copy. */
  describeWorkspace(): Promise<{ baseUrl: string; email: string }>;
}
