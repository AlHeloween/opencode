# Закреплённая modern SCIP schema

Runtime использует FileDescriptorProto официального Go binding
`github.com/scip-code/scip/bindings/go/scip v0.7.1`. Точные SHA256 upstream
`scip.pb.go`, `go.mod`, `LICENSE` и generated `schema.pb` находятся в SOURCE.json.
Генератор: `pwsh -NoProfile -File scripts/vendor-modern-scip.ps1` из корня module.
Standalone generator имеет собственный go.mod/go.sum и не импортируется runtime.
Проверка: `TestPinnedDescriptorAndPrivateRegistry` сравнивает descriptor с pin,
проверяет исходные имена/номера полей и отсутствие регистрации в GlobalFiles.

Descriptor создаёт dynamic messages в private registry. Это позволяет держать
legacy generated binding с теми же protobuf full names без глобальной коллизии.
Upstream package/type/field identity не переименовывается. Raw index не меняется.

Modern profile `dais-scip-modern-utf8-v1` требует metadata UTF8 и явный Document
position_encoding UTF8CodeUnitOffsetFromLineStart (1). Неизвестные поля/enum/roles,
UTF16/UTF32/неуказанные position units и неверные byte ranges отвергаются.
Document header сохраняет language/path/text/position_encoding, SymbolInformation
и Occurrence сохраняют полный protobuf JSON payload, включая signature docs,
diagnostics, enclosing symbols/ranges и relationship flags. Signature documentation
остаётся отдельным вложенным payload, не трактуется как файл Fossil.

Наблюдаемый native scip-go v0.2.7 пишет Windows project_root как
`file://D:%5Cpath`, а не `file:///D:/path`. Modern profile распознаёт этот узкий
диалект по букве диска, двоеточию и абсолютному разделителю после UTF8 percent
decode; исходное значение сохраняется. Оно не используется для доступа к файлам:
все source bytes приходят через закреплённый Fossil manifest. Неверные escape,
невалидный UTF8, control characters и drive-relative paths отвергаются.

Совпадение проекции с закреплёнными bytes не доказывает семантическую правильность
индексатора, поэтому verifier сохраняет semantic_status=unknown.
