package fossil
import "strings"
type A struct{}
type B struct{}

func (A) Same() int { return 1 }
func (B) Same() int { return 2 }
func Top() int { return len(strings.TrimSpace(" x ")) + 2 }
func hidden() int { return 4 }
