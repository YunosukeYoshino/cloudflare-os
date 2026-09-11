import { Autocomplete, Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  ProbeRunConfiguratorRpc,
  ProbeRunConfiguratorValues,
} from "./run-configurator-types";

export default {
  initial: {},

  isReady({ values }) {
    return typeof values.runId === "string" && values.runId.length > 0;
  },

  initialValuesFromResourceUrl({ resourceUrl }) {
    try {
      const parsed = new URL(resourceUrl);
      if (parsed.hostname !== "run") return {};
      const runId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      return runId ? { runId } : {};
    } catch {
      return {};
    }
  },

  resourceUrl({ values }) {
    return `probe://run/${encodeURIComponent(values.runId ?? "")}`;
  },

  render({ values, setValues, ui }) {
    return <Section>
      <Field label="Run" description="Choose one Probe run. The binding can read it and cannot start new runs.">
        <Autocomplete
          name="runId"
          value={values.runId}
          placeholder="Search runs..."
          loadOptions={query => ui.listRuns(query)}
          onChange={runId => setValues({ runId })}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<ProbeRunConfiguratorRpc, ProbeRunConfiguratorValues>;
