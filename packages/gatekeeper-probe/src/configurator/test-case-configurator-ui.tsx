import { Autocomplete, Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  ProbeTestCaseConfiguratorRpc,
  ProbeTestCaseConfiguratorValues,
} from "./test-case-configurator-types";

export default {
  initial: {},

  isReady({ values }) {
    return typeof values.testCaseId === "string" && values.testCaseId.length > 0;
  },

  initialValuesFromResourceUrl({ resourceUrl }) {
    try {
      const parsed = new URL(resourceUrl);
      if (parsed.hostname !== "test-case") return {};
      const testCaseId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      return testCaseId ? { testCaseId } : {};
    } catch {
      return {};
    }
  },

  resourceUrl({ values }) {
    return `probe://test-case/${encodeURIComponent(values.testCaseId ?? "")}`;
  },

  render({ values, setValues, ui }) {
    return <Section>
      <Field label="Test case" description="Choose one Probe test case. The binding can read it and start runs of it.">
        <Autocomplete
          name="testCaseId"
          value={values.testCaseId}
          placeholder="Search test cases..."
          loadOptions={query => ui.listTestCases(query)}
          onChange={testCaseId => setValues({ testCaseId })}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<ProbeTestCaseConfiguratorRpc, ProbeTestCaseConfiguratorValues>;
