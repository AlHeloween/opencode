<!-- sv: native-producer 0.40, explicit-encoding 0.35, reproducibility 0.25 -->
# scip-go v0.2.7: явная кодировка координат UTF8

CONFIRMED ✓ native runtime 20261017T054016Z_8d942cee: официальный scip-go v0.2.7
создаёт бинарный индекс на Windows. Его Document не задаёт position_encoding.
Строгий modern-импортёр отвергает неоднозначность; исходный индекс сохранён как
отрицательная fixture. visitor_file.go:359–364 создаёт Document;
symbols/symbols.go:33–37 использует байтовые Go token columns и len(name).

Проверяемый patch задаёт UTF8CodeUnitOffsetFromLineStart в producer ДО сериализации.
Существующий индекс не переписывается. Квитанция capture закрепляет SHA256
реального candidate executable; ToolInfo сохраняет базовую upstream-версию v0.2.7.
Это candidate-сборка DAIS, отличимая по хешу от официального executable.

scripts/build-scip-go.ps1 закрепляет байты оригинала, копирует module в новый
scratch с побайтной сверкой каждого файла, проверяет и применяет patch,
сверяет LF-нормализованный хеш candidate и компилирует из candidate-копии.
После сборки оригинальные файлы проверяются повторно. Module cache и external-
клоны не редактируются. Полученный SCIP и квитанции сохраняют исходные байты.
Первый overlay-подход (20261017T054803Z_936f45a1) диагностированно отвергнут
Go1.26: подмена файлов внутри GOMODCACHE запрещена; поэтому используется полная
проверяемая candidate-копия. Этот отказ сохраняется в evidence archive.

Вызывающий задаёт закреплённый native Go executable, каталог загруженного module
scip-go v0.2.7, новые scratch/output paths. Публичные зависимости получают отдельно;
сам capture использует явное offline-окружение. Лицензия исходника Apache-2.0
находится в upstream module. Официальный источник:
https://github.com/scip-code/scip-go/tree/v0.2.7
