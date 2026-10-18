package capture

import "dais.local/codeintelligence/internal/fossil"

var AValue = fossil.A{}.Same
var BValue = fossil.B{}.Same
var MovingValue = fossil.Moving
func Calls() int { return fossil.A{}.Same() + fossil.B{}.Same() + fossil.Moving() }
