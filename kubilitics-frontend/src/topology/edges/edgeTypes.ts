import type { EdgeTypes } from "@xyflow/react";

import { LabeledEdge } from "./LabeledEdge";
import { AnimatedEdge } from "./AnimatedEdge";

export const edgeTypes: EdgeTypes = {
  labeled: LabeledEdge,
  animated: AnimatedEdge,
};

