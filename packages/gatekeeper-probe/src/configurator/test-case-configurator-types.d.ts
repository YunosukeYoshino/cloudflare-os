export type ConfiguratorOption = {
  value: string;
  title: string;
  subtitle?: string;
  meta?: string;
};

export type ProbeTestCaseConfiguratorValues = {
  testCaseId?: string | null;
};

export interface ProbeTestCaseConfiguratorRpc {
  listTestCases(query: string): Promise<ConfiguratorOption[]>;
}
