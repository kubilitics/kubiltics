package main

import (
	"fmt"
	tools "github.com/vellankikoti/kubilitics/brain/internal/mcp/tools"
)

func main() {
	fmt.Printf("taxonomy (ToolTaxonomy):          %d\n", len(tools.ToolTaxonomy))
	fmt.Printf("chat tools (GetChatTools):        %d\n", len(tools.GetChatTools()))
	fmt.Printf("chat tool defs:                   %d\n", len(tools.GetChatToolDefinitions()))
	fmt.Printf("non-destructive:                  %d\n", len(tools.GetNonDestructiveTools()))
	fmt.Printf("AI-powered:                       %d\n", len(tools.GetAIPoweredTools()))
}
