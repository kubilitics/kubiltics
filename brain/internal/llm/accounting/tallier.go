package accounting

// Tallier accumulates token counts for a single chat turn and reports
// the running cost in USD based on the model's published price. Goroutine
// safe — bench concurrency relies on this.
type Tallier struct {
	model string
	price Price
	in    int
	out   int
}

func NewTallier(model string) *Tallier {
	return &Tallier{model: model, price: lookupPrice(model)}
}

func NewTallierWithPrice(model string, p Price) *Tallier {
	return &Tallier{model: model, price: p}
}

func (t *Tallier) Model() string       { return t.model }
func (t *Tallier) InputTokens() int    { return t.in }
func (t *Tallier) OutputTokens() int   { return t.out }

func (t *Tallier) AddInput(n int)  { t.in += n }
func (t *Tallier) AddOutput(n int) { t.out += n }

// USD returns cost in dollars. For models not in priceTable, the return
// is 0 by design (see lookupPrice).
func (t *Tallier) USD() float64 {
	return float64(t.in)/1e6*t.price.InputPerM + float64(t.out)/1e6*t.price.OutputPerM
}
