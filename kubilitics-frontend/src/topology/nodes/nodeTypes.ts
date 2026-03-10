import type { NodeTypes } from "@xyflow/react";

import { BaseNode } from "./BaseNode";
import { CompactNode } from "./CompactNode";
import { ExpandedNode } from "./ExpandedNode";
import { MinimalNode } from "./MinimalNode";
import { GroupNode } from "./GroupNode";
import { SummaryNode } from "./SummaryNode";

export const nodeTypes: NodeTypes = {
  base: BaseNode,
  compact: CompactNode,
  expanded: ExpandedNode,
  minimal: MinimalNode,
  group: GroupNode,
  summary: SummaryNode,
};

