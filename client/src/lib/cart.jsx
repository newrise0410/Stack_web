import { createContext, useContext, useMemo, useReducer } from 'react';

const CartContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { id, qty = 1 } = action;
      const existing = state.find((l) => l.id === id);
      if (existing) {
        return state.map((l) => (l.id === id ? { ...l, qty: l.qty + qty } : l));
      }
      return [...state, { id, qty }];
    }
    case 'remove':
      return state.filter((l) => l.id !== action.id);
    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const [lines, dispatch] = useReducer(reducer, []);
  const value = useMemo(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    return {
      lines,
      count,
      add: (id, qty) => dispatch({ type: 'add', id, qty }),
      remove: (id) => dispatch({ type: 'remove', id }),
    };
  }, [lines]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
