export type ConfiguratorOption = {
  value: string;
  title: string;
  subtitle?: string;
  meta?: string;
};

export type ProbeRunConfiguratorValues = {
  runId?: string | null;
};

export interface ProbeRunConfiguratorRpc {
  listRuns(query: string): Promise<ConfiguratorOption[]>;
}
