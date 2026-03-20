import * as React from 'react';

/** Context for table filter visibility - when false, column filter UI is hidden. */
const TableFilterContext = React.createContext<boolean>(true);

export const TableFilterProvider = TableFilterContext.Provider;

export function useTableFilterVisible(): boolean {
  return React.useContext(TableFilterContext);
}
