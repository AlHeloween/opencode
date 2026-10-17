// Package scipmodern decodes the pinned modern SCIP schema in a private registry.
package scipmodern

import (
	_ "embed"
	"fmt"
	"sync"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

//go:embed schema.pb
var schema []byte

var descriptor = sync.OnceValues(func() (protoreflect.FileDescriptor, error) {
	var message descriptorpb.FileDescriptorProto
	if err := proto.Unmarshal(schema, &message); err != nil {
		return nil, err
	}
	return protodesc.NewFile(&message, new(protoregistry.Files))
})

func NewIndex() (*dynamicpb.Message, error) {
	file, err := descriptor()
	if err != nil {
		return nil, err
	}
	index := file.Messages().ByName("Index")
	if index == nil {
		return nil, fmt.Errorf("pinned SCIP descriptor has no Index")
	}
	return dynamicpb.NewMessage(index), nil
}
