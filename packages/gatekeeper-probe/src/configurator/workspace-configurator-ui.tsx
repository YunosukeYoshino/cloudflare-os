import { Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  ProbeWorkspaceConfiguratorRpc,
  ProbeWorkspaceConfiguratorValues,
} from "./workspace-configurator-types";

export default {
  initial: { confirmed: "yes" },

  isReady() {
    return true;
  },

  resourceUrl({ ui }) {
    return ui.resourceUrl();
  },

  render() {
    return <Section>
      <Field
        label="Workspace access"
        description="This binding can list every test case and run the connected Probe user can see, and can start runs (queued for your confirmation).">
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<ProbeWorkspaceConfiguratorRpc, ProbeWorkspaceConfiguratorValues>;
