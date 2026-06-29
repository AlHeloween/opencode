(module
 (type $0 (func (param i32 i32 i32) (result i32)))
 (type $1 (func (param i32 i32) (result i32)))
 (type $2 (func (param i32) (result i32)))
 (type $3 (func (param i32 i32 i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $mimport$0 2))
 (import "env" "strlen" (func $fimport$0 (param i32) (result i32)))
 (global $global$0 (mut i32) (i32.const 65536))
 (data $0 (i32.const 65536) "}\00,\"newStart\":\00\"oldStart\":\00,\"length\":\00,\"newEnd\":\00,\"oldEnd\":\00{\"type\":\"insert\",\00{\"type\":\"equal\",\00{\"type\":\"delete\",\00")
 (export "__stack_pointer" (global $global$0))
 (export "diff_compute" (func $0))
 (func $0 (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (result i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i64)
  (local $22 i64)
  (local $23 i64)
  (local $scratch i32)
  (global.set $global$0
   (local.tee $10
    (i32.sub
     (global.get $global$0)
     (i32.const 786464)
    )
   )
  )
  (local.set $scratch
   (block $block (result i32)
    (drop
     (br_if $block
      (i32.const 0)
      (i32.le_s
       (local.get $5)
       (i32.const 0)
      )
     )
    )
    (if
     (i32.eqz
      (i32.or
       (i32.gt_s
        (local.get $1)
        (i32.const 0)
       )
       (i32.gt_s
        (local.get $3)
        (i32.const 0)
       )
      )
     )
     (then
      (i32.store8
       (i32.add
        (local.get $4)
        (i32.const 1)
       )
       (i32.const 93)
      )
      (br $block
       (i32.const 2)
      )
     )
    )
    (local.set $1
     (select
      (local.tee $1
       (i32.or
        (i32.shl
         (local.tee $11
          (i32.add
           (local.tee $0
            (call $1
             (local.get $0)
             (local.get $1)
             (i32.const 1048576)
            )
           )
           (local.tee $14
            (call $1
             (local.get $2)
             (local.get $3)
             (i32.const 1179648)
            )
           )
          )
         )
         (i32.const 1)
        )
        (i32.const 1)
       )
      )
      (i32.const 0)
      (i32.gt_s
       (local.get $1)
       (i32.const 0)
      )
     )
    )
    (local.set $3
     (i32.const 1310720)
    )
    (loop $label
     (if
      (local.get $1)
      (then
       (i32.store
        (local.get $3)
        (i32.const -1)
       )
       (local.set $1
        (i32.sub
         (local.get $1)
         (i32.const 1)
        )
       )
       (local.set $3
        (i32.add
         (local.get $3)
         (i32.const 4)
        )
       )
       (br $label)
      )
      (else
       (block $block1
        (i32.store
         (i32.add
          (local.tee $1
           (i32.shl
            (local.get $11)
            (i32.const 2)
           )
          )
          (i32.const 1310724)
         )
         (i32.const 0)
        )
        (local.set $12
         (i32.add
          (local.get $1)
          (i32.const 1310720)
         )
        )
        (local.set $15
         (i32.add
          (i32.shl
           (local.get $11)
           (i32.const 3)
          )
          (i32.const 1310724)
         )
        )
        (loop $label3
         (if
          (i32.eqz
           (i32.and
            (i32.lt_u
             (local.get $8)
             (i32.const 32768)
            )
            (i32.le_s
             (local.get $8)
             (local.get $11)
            )
           )
          )
          (then
           (local.set $7
            (select
             (i32.const 1)
             (local.get $11)
             (i32.le_s
              (local.get $11)
              (i32.const 1)
             )
            )
           )
           (br $block1)
          )
         )
         (local.set $16
          (i32.add
           (local.get $15)
           (i32.shl
            (local.get $8)
            (i32.const 3)
           )
          )
         )
         (local.set $17
          (i32.sub
           (i32.add
            (local.get $12)
            (local.tee $1
             (i32.shl
              (local.get $8)
              (i32.const 2)
             )
            )
           )
           (i32.const 4)
          )
         )
         (local.set $18
          (i32.add
           (i32.sub
            (local.get $12)
            (local.get $1)
           )
           (i32.const 4)
          )
         )
         (local.set $9
          (local.get $8)
         )
         (local.set $7
          (local.tee $19
           (i32.sub
            (i32.const 0)
            (local.get $8)
           )
          )
         )
         (loop $label1
          (if
           (i32.le_s
            (local.get $7)
            (local.get $8)
           )
           (then
            (block $block2
             (if
              (i32.eq
               (local.get $7)
               (local.get $19)
              )
              (then
               (local.set $1
                (i32.load
                 (local.get $18)
                )
               )
               (br $block2)
              )
             )
             (block $block3
              (if
               (i32.eq
                (local.get $7)
                (local.get $8)
               )
               (then
                (local.set $3
                 (i32.load
                  (local.get $17)
                 )
                )
                (br $block3)
               )
              )
              (br_if $block2
               (i32.lt_s
                (local.tee $3
                 (i32.load
                  (i32.sub
                   (local.tee $1
                    (i32.add
                     (local.get $12)
                     (i32.shl
                      (local.get $7)
                      (i32.const 2)
                     )
                    )
                   )
                   (i32.const 4)
                  )
                 )
                )
                (local.tee $1
                 (i32.load
                  (i32.add
                   (local.get $1)
                   (i32.const 4)
                  )
                 )
                )
               )
              )
             )
             (local.set $1
              (i32.add
               (local.get $3)
               (i32.const 1)
              )
             )
            )
            (local.set $3
             (i32.sub
              (i32.shl
               (local.get $1)
               (i32.const 3)
              )
              (i32.const -1048576)
             )
            )
            (local.set $2
             (i32.add
              (i32.shl
               (i32.add
                (local.get $1)
                (local.get $9)
               )
               (i32.const 3)
              )
              (i32.const 1179648)
             )
            )
            (loop $label2
             (local.set $13
              (i32.gt_s
               (local.get $0)
               (local.get $1)
              )
             )
             (local.set $6
              (i32.lt_s
               (local.tee $20
                (i32.add
                 (local.get $1)
                 (local.get $9)
                )
               )
               (local.get $14)
              )
             )
             (block $block4
              (if
               (i32.eqz
                (i32.or
                 (i32.le_s
                  (local.get $0)
                  (local.get $1)
                 )
                 (i32.le_s
                  (local.get $14)
                  (local.get $20)
                 )
                )
               )
               (then
                (br_if $block4
                 (call $2
                  (local.get $3)
                  (local.get $2)
                 )
                )
                (local.set $13
                 (i32.const 1)
                )
                (local.set $6
                 (i32.const 1)
                )
               )
              )
              (i32.store
               (i32.add
                (local.get $12)
                (i32.shl
                 (local.get $7)
                 (i32.const 2)
                )
               )
               (local.get $1)
              )
              (i32.store offset=4
               (local.get $16)
               (local.get $1)
              )
              (i32.store
               (local.get $16)
               (local.get $7)
              )
              (local.set $9
               (i32.sub
                (local.get $9)
                (i32.const 2)
               )
              )
              (local.set $7
               (i32.add
                (local.get $7)
                (i32.const 2)
               )
              )
              (br_if $label1
               (i32.or
                (local.get $6)
                (local.get $13)
               )
              )
              (local.set $7
               (i32.add
                (local.get $8)
                (i32.const 1)
               )
              )
              (br $block1)
             )
             (local.set $2
              (i32.add
               (local.get $2)
               (i32.const 8)
              )
             )
             (local.set $3
              (i32.add
               (local.get $3)
               (i32.const 8)
              )
             )
             (local.set $1
              (i32.add
               (local.get $1)
               (i32.const 1)
              )
             )
             (br $label2)
            )
            (unreachable)
           )
          )
         )
         (local.set $8
          (i32.add
           (local.get $8)
           (i32.const 1)
          )
         )
         (br $label3)
        )
        (unreachable)
       )
      )
     )
    )
    (local.set $6
     (i32.const 0)
    )
    (loop $label4
     (block $block5
      (if
       (i32.le_s
        (local.get $7)
        (i32.const 0)
       )
       (then
        (local.set $2
         (select
          (local.tee $0
           (i32.div_s
            (local.get $6)
            (i32.const 2)
           )
          )
          (i32.const 0)
          (i32.gt_s
           (local.get $0)
           (i32.const 0)
          )
         )
        )
        (local.set $1
         (i32.add
          (i32.add
           (i32.mul
            (local.get $6)
            (i32.const 24)
           )
           (local.get $10)
          )
          (i32.const 8)
         )
        )
        (local.set $3
         (i32.add
          (local.get $10)
          (i32.const 32)
         )
        )
        (br $block5)
       )
      )
      (local.set $3
       (i32.add
        (i32.sub
         (local.tee $9
          (i32.shl
           (local.tee $1
            (i32.load offset=4
             (local.tee $2
              (i32.add
               (local.get $15)
               (i32.shl
                (local.tee $8
                 (i32.sub
                  (local.get $7)
                  (i32.const 1)
                 )
                )
                (i32.const 3)
               )
              )
             )
            )
           )
           (i32.const 3)
          )
         )
         (i32.shl
          (local.tee $11
           (i32.load
            (local.get $2)
           )
          )
          (i32.const 3)
         )
        )
        (i32.const 1179640)
       )
      )
      (local.set $12
       (i32.sub
        (i32.const 0)
        (local.get $11)
       )
      )
      (local.set $2
       (i32.add
        (local.get $9)
        (i32.const 1048568)
       )
      )
      (loop $label5
       (local.set $9
        (i32.gt_s
         (local.get $1)
         (i32.const 0)
        )
       )
       (local.set $13
        (i32.gt_s
         (local.tee $14
          (i32.add
           (local.get $1)
           (local.get $12)
          )
         )
         (i32.const 0)
        )
       )
       (block $block6
        (if
         (i32.eqz
          (i32.or
           (i32.le_s
            (local.get $1)
            (i32.const 0)
           )
           (i32.le_s
            (local.get $14)
            (i32.const 0)
           )
          )
         )
         (then
          (br_if $block6
           (call $2
            (local.get $2)
            (local.get $3)
           )
          )
          (local.set $13
           (i32.const 1)
          )
          (local.set $9
           (i32.const 1)
          )
         )
        )
        (local.set $3
         (i32.sub
          (local.get $1)
          (local.get $11)
         )
        )
        (if
         (i32.eqz
          (i32.or
           (i32.le_s
            (local.tee $2
             (i32.sub
              (local.get $0)
              (local.get $1)
             )
            )
            (i32.const 0)
           )
           (i32.gt_s
            (local.get $6)
            (i32.const 32767)
           )
          )
         )
         (then
          (i32.store offset=20
           (local.tee $0
            (i32.add
             (i32.add
              (local.get $10)
              (i32.const 32)
             )
             (i32.mul
              (local.get $6)
              (i32.const 24)
             )
            )
           )
           (local.get $2)
          )
          (i32.store offset=12
           (local.get $0)
           (local.get $3)
          )
          (i32.store offset=4
           (local.get $0)
           (local.get $1)
          )
          (i32.store
           (local.get $0)
           (i32.const 0)
          )
          (local.set $6
           (i32.add
            (local.get $6)
            (i32.const 1)
           )
          )
         )
        )
        (block $block7
         (if
          (i32.ne
           (local.get $7)
           (i32.const 1)
          )
          (then
           (local.set $2
            (i32.sub
             (local.tee $0
              (i32.load
               (i32.sub
                (local.tee $2
                 (i32.add
                  (local.get $15)
                  (i32.shl
                   (local.get $7)
                   (i32.const 3)
                  )
                 )
                )
                (i32.const 12)
               )
              )
             )
             (i32.load
              (i32.sub
               (local.get $2)
               (i32.const 16)
              )
             )
            )
           )
           (if
            (i32.eqz
             (i32.or
              (i32.gt_s
               (local.get $6)
               (i32.const 32767)
              )
              (i32.ge_s
               (local.get $0)
               (local.get $1)
              )
             )
            )
            (then
             (i32.store offset=8
              (local.tee $7
               (i32.add
                (i32.add
                 (local.get $10)
                 (i32.const 32)
                )
                (i32.mul
                 (local.get $6)
                 (i32.const 24)
                )
               )
              )
              (local.get $1)
             )
             (i32.store offset=4
              (local.get $7)
              (local.get $0)
             )
             (i32.store
              (local.get $7)
              (i32.const 1)
             )
             (local.set $6
              (i32.add
               (local.get $6)
               (i32.const 1)
              )
             )
            )
           )
           (local.set $7
            (local.get $8)
           )
           (br_if $label4
            (i32.or
             (i32.ge_s
              (local.get $2)
              (local.get $3)
             )
             (i32.ge_s
              (local.get $6)
              (i32.const 32768)
             )
            )
           )
           (br $block7)
          )
         )
         (if
          (i32.and
           (i32.lt_s
            (local.get $6)
            (i32.const 32768)
           )
           (local.get $9)
          )
          (then
           (i32.store offset=8
            (local.tee $0
             (i32.add
              (i32.add
               (local.get $10)
               (i32.const 32)
              )
              (i32.mul
               (local.get $6)
               (i32.const 24)
              )
             )
            )
            (local.get $1)
           )
           (i64.store
            (local.get $0)
            (i64.const 1)
           )
           (local.set $6
            (i32.add
             (local.get $6)
             (i32.const 1)
            )
           )
          )
         )
         (local.set $0
          (i32.const 0)
         )
         (local.set $7
          (local.get $8)
         )
         (local.set $2
          (i32.const 0)
         )
         (br_if $label4
          (i32.eqz
           (i32.and
            (local.get $13)
            (i32.lt_s
             (local.get $6)
             (i32.const 32768)
            )
           )
          )
         )
        )
        (i32.store offset=16
         (local.tee $1
          (i32.add
           (i32.add
            (local.get $10)
            (i32.const 32)
           )
           (i32.mul
            (local.get $6)
            (i32.const 24)
           )
          )
         )
         (local.get $3)
        )
        (i32.store offset=12
         (local.get $1)
         (local.get $2)
        )
        (i32.store
         (local.get $1)
         (i32.const 2)
        )
        (local.set $6
         (i32.add
          (local.get $6)
          (i32.const 1)
         )
        )
        (br $label4)
       )
       (local.set $2
        (i32.sub
         (local.get $2)
         (i32.const 8)
        )
       )
       (local.set $3
        (i32.sub
         (local.get $3)
         (i32.const 8)
        )
       )
       (local.set $1
        (i32.sub
         (local.get $1)
         (i32.const 1)
        )
       )
       (br $label5)
      )
      (unreachable)
     )
    )
    (loop $label6
     (if
      (local.get $2)
      (then
       (local.set $21
        (i64.load offset=16 align=4
         (local.get $3)
        )
       )
       (i64.store offset=16
        (local.get $3)
        (i64.load offset=16
         (local.get $1)
        )
       )
       (local.set $22
        (i64.load offset=8 align=4
         (local.get $3)
        )
       )
       (i64.store offset=8
        (local.get $3)
        (i64.load offset=8
         (local.get $1)
        )
       )
       (local.set $23
        (i64.load align=4
         (local.get $3)
        )
       )
       (i64.store
        (local.get $3)
        (i64.load
         (local.get $1)
        )
       )
       (i64.store align=4
        (local.get $1)
        (local.get $23)
       )
       (i64.store offset=16 align=4
        (local.get $1)
        (local.get $21)
       )
       (i64.store offset=8 align=4
        (local.get $1)
        (local.get $22)
       )
       (local.set $2
        (i32.sub
         (local.get $2)
         (i32.const 1)
        )
       )
       (local.set $1
        (i32.sub
         (local.get $1)
         (i32.const 24)
        )
       )
       (local.set $3
        (i32.add
         (local.get $3)
         (i32.const 24)
        )
       )
       (br $label6)
      )
     )
    )
    (local.set $2
     (select
      (local.get $6)
      (i32.const 0)
      (i32.gt_s
       (local.get $6)
       (i32.const 0)
      )
     )
    )
    (local.set $1
     (i32.add
      (local.get $10)
      (i32.const 32)
     )
    )
    (local.set $3
     (i32.const 1)
    )
    (local.set $0
     (i32.const 1)
    )
    (loop $label7
     (if
      (local.get $2)
      (then
       (if
        (i32.eqz
         (i32.and
          (local.get $0)
          (i32.const 1)
         )
        )
        (then
         (i32.store8
          (i32.add
           (local.get $3)
           (local.get $4)
          )
          (i32.const 44)
         )
         (local.set $3
          (i32.add
           (local.get $3)
           (i32.const 1)
          )
         )
        )
       )
       (local.set $3
        (i32.add
         (call $3
          (local.get $4)
          (local.tee $0
           (block $block11 (result i32)
            (block $block10
             (block $block9
              (block $block8
               (br_table $block8 $block9 $block10
                (i32.load
                 (local.get $1)
                )
               )
              )
              (br $block11
               (i32.add
                (call $4
                 (i32.add
                  (local.get $4)
                  (local.tee $0
                   (i32.add
                    (call $3
                     (local.get $4)
                     (local.tee $0
                      (i32.add
                       (call $4
                        (i32.add
                         (local.get $4)
                         (local.tee $0
                          (i32.add
                           (call $3
                            (local.get $4)
                            (local.tee $0
                             (i32.add
                              (call $4
                               (i32.add
                                (local.get $4)
                                (local.tee $0
                                 (i32.add
                                  (call $3
                                   (local.get $4)
                                   (local.tee $0
                                    (i32.add
                                     (call $3
                                      (local.get $4)
                                      (local.get $3)
                                      (i32.const 65614)
                                     )
                                     (local.get $3)
                                    )
                                   )
                                   (i32.const 65551)
                                  )
                                  (local.get $0)
                                 )
                                )
                               )
                               (i32.load
                                (i32.add
                                 (local.get $1)
                                 (i32.const 4)
                                )
                               )
                              )
                              (local.get $0)
                             )
                            )
                            (i32.const 65538)
                           )
                           (local.get $0)
                          )
                         )
                        )
                        (i32.load
                         (i32.add
                          (local.get $1)
                          (i32.const 12)
                         )
                        )
                       )
                       (local.get $0)
                      )
                     )
                     (i32.const 65563)
                    )
                    (local.get $0)
                   )
                  )
                 )
                 (i32.load
                  (i32.add
                   (local.get $1)
                   (i32.const 20)
                  )
                 )
                )
                (local.get $0)
               )
              )
             )
             (br $block11
              (i32.add
               (call $4
                (i32.add
                 (local.get $4)
                 (local.tee $0
                  (i32.add
                   (call $3
                    (local.get $4)
                    (local.tee $0
                     (i32.add
                      (call $4
                       (i32.add
                        (local.get $4)
                        (local.tee $0
                         (i32.add
                          (call $3
                           (local.get $4)
                           (local.tee $0
                            (i32.add
                             (call $3
                              (local.get $4)
                              (local.get $3)
                              (i32.const 65631)
                             )
                             (local.get $3)
                            )
                           )
                           (i32.const 65551)
                          )
                          (local.get $0)
                         )
                        )
                       )
                       (i32.load
                        (i32.add
                         (local.get $1)
                         (i32.const 4)
                        )
                       )
                      )
                      (local.get $0)
                     )
                    )
                    (i32.const 65585)
                   )
                   (local.get $0)
                  )
                 )
                )
                (i32.load
                 (i32.add
                  (local.get $1)
                  (i32.const 8)
                 )
                )
               )
               (local.get $0)
              )
             )
            )
            (i32.add
             (call $4
              (i32.add
               (local.get $4)
               (local.tee $0
                (i32.add
                 (call $3
                  (local.get $4)
                  (local.tee $0
                   (i32.add
                    (call $4
                     (i32.add
                      (local.get $4)
                      (local.tee $0
                       (i32.add
                        (call $3
                         (local.get $4)
                         (local.tee $0
                          (i32.add
                           (call $3
                            (local.get $4)
                            (local.get $3)
                            (i32.const 65596)
                           )
                           (local.get $3)
                          )
                         )
                         (i32.const 65539)
                        )
                        (local.get $0)
                       )
                      )
                     )
                     (i32.load
                      (i32.add
                       (local.get $1)
                       (i32.const 12)
                      )
                     )
                    )
                    (local.get $0)
                   )
                  )
                  (i32.const 65574)
                 )
                 (local.get $0)
                )
               )
              )
              (i32.load
               (i32.add
                (local.get $1)
                (i32.const 16)
               )
              )
             )
             (local.get $0)
            )
           )
          )
          (i32.const 65536)
         )
         (local.get $0)
        )
       )
       (local.set $2
        (i32.sub
         (local.get $2)
         (i32.const 1)
        )
       )
       (local.set $1
        (i32.add
         (local.get $1)
         (i32.const 24)
        )
       )
       (local.set $0
        (i32.const 0)
       )
       (br $label7)
      )
     )
    )
    (i32.store8
     (i32.add
      (local.get $3)
      (local.get $4)
     )
     (i32.const 93)
    )
    (select
     (local.tee $0
      (i32.add
       (local.get $3)
       (i32.const 1)
      )
     )
     (local.get $5)
     (i32.lt_s
      (local.get $0)
      (local.get $5)
     )
    )
   )
  )
  (global.set $global$0
   (i32.add
    (local.get $10)
    (i32.const 786464)
   )
  )
  (local.get $scratch)
 )
 (func $1 (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local.set $6
   (i32.sub
    (i32.const 0)
    (local.get $1)
   )
  )
  (local.set $7
   (i32.sub
    (local.get $0)
    (i32.const 1)
   )
  )
  (loop $label1
   (local.set $8
    (i32.add
     (local.get $3)
     (local.get $6)
    )
   )
   (local.set $4
    (i32.add
     (local.get $3)
     (local.get $7)
    )
   )
   (local.set $9
    (i32.gt_u
     (local.get $5)
     (i32.const 16383)
    )
   )
   (local.set $0
    (i32.const 0)
   )
   (block $block
    (loop $label
     (br_if $block
      (i32.or
       (i32.gt_s
        (local.tee $10
         (i32.add
          (local.get $0)
          (local.get $3)
         )
        )
        (local.get $1)
       )
       (local.get $9)
      )
     )
     (block $block1
      (br_if $block1
       (i32.eqz
        (i32.add
         (local.get $0)
         (local.get $8)
        )
       )
      )
      (br_if $block1
       (i32.eq
        (i32.load8_u
         (i32.add
          (i32.add
           (local.get $0)
           (local.get $4)
          )
          (i32.const 1)
         )
        )
        (i32.const 10)
       )
      )
      (local.set $0
       (i32.add
        (local.get $0)
        (i32.const 1)
       )
      )
      (br $label)
     )
    )
    (if
     (i32.gt_s
      (local.get $0)
      (i32.const 0)
     )
     (then
      (local.set $0
       (i32.sub
        (local.get $0)
        (i32.eq
         (i32.load8_u
          (i32.add
           (local.get $0)
           (local.get $4)
          )
         )
         (i32.const 13)
        )
       )
      )
     )
    )
    (i32.store offset=4
     (local.tee $4
      (i32.add
       (local.get $2)
       (i32.shl
        (local.get $5)
        (i32.const 3)
       )
      )
     )
     (local.get $0)
    )
    (i32.store
     (local.get $4)
     (local.get $3)
    )
    (local.set $5
     (i32.add
      (local.get $5)
      (i32.const 1)
     )
    )
    (local.set $3
     (i32.add
      (local.get $10)
      (i32.const 1)
     )
    )
    (br $label1)
   )
  )
  (local.get $5)
 )
 (func $2 (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (if (result i32)
   (i32.eq
    (local.tee $2
     (i32.load offset=4
      (local.get $0)
     )
    )
    (i32.load offset=4
     (local.get $1)
    )
   )
   (then
    (local.set $3
     (select
      (local.get $2)
      (i32.const 0)
      (i32.gt_s
       (local.get $2)
       (i32.const 0)
      )
     )
    )
    (local.set $1
     (i32.load
      (local.get $1)
     )
    )
    (local.set $4
     (i32.load
      (local.get $0)
     )
    )
    (loop $label
     (if
      (i32.ne
       (local.tee $0
        (local.get $5)
       )
       (local.get $3)
      )
      (then
       (local.set $5
        (i32.add
         (local.get $0)
         (i32.const 1)
        )
       )
       (br_if $label
        (i32.eq
         (i32.load8_u
          (i32.add
           (local.get $0)
           (local.get $4)
          )
         )
         (i32.load8_u
          (i32.add
           (local.get $0)
           (local.get $1)
          )
         )
        )
       )
      )
     )
    )
    (i32.ge_s
     (local.get $0)
     (local.get $2)
    )
   )
   (else
    (i32.const 0)
   )
  )
 )
 (func $3 (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
  (local $3 i32)
  (local $4 i32)
  (local.set $3
   (i32.add
    (local.get $0)
    (local.get $1)
   )
  )
  (local.set $0
   (local.tee $4
    (call $fimport$0
     (local.get $2)
    )
   )
  )
  (loop $label (result i32)
   (if (result i32)
    (local.get $0)
    (then
     (i32.store8
      (local.get $3)
      (i32.load8_u
       (local.get $2)
      )
     )
     (local.set $0
      (i32.sub
       (local.get $0)
       (i32.const 1)
      )
     )
     (local.set $3
      (i32.add
       (local.get $3)
       (i32.const 1)
      )
     )
     (local.set $2
      (i32.add
       (local.get $2)
       (i32.const 1)
      )
     )
     (br $label)
    )
    (else
     (i32.add
      (local.get $1)
      (local.get $4)
     )
    )
   )
  )
 )
 (func $4 (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local.set $4
   (i32.sub
    (global.get $global$0)
    (i32.const 16)
   )
  )
  (block $block
   (if
    (i32.eqz
     (local.get $1)
    )
    (then
     (i32.store8
      (local.get $0)
      (i32.const 48)
     )
     (local.set $3
      (i32.const 1)
     )
     (br $block)
    )
   )
   (local.set $2
    (i32.sub
     (i32.xor
      (local.get $1)
      (local.tee $2
       (i32.shr_s
        (local.get $1)
        (i32.const 31)
       )
      )
     )
     (local.get $2)
    )
   )
   (loop $label
    (if
     (local.get $2)
     (then
      (i32.store8
       (i32.add
        (i32.add
         (local.get $4)
         (i32.const 4)
        )
        (local.get $3)
       )
       (i32.or
        (i32.sub
         (local.get $2)
         (i32.mul
          (local.tee $2
           (i32.div_u
            (local.get $2)
            (i32.const 10)
           )
          )
          (i32.const 10)
         )
        )
        (i32.const 48)
       )
      )
      (local.set $3
       (i32.add
        (local.get $3)
        (i32.const 1)
       )
      )
      (br $label)
     )
    )
   )
   (if
    (i32.lt_s
     (local.get $1)
     (i32.const 0)
    )
    (then
     (i32.store8
      (i32.add
       (i32.add
        (local.get $4)
        (i32.const 4)
       )
       (local.get $3)
      )
      (i32.const 45)
     )
     (local.set $3
      (i32.add
       (local.get $3)
       (i32.const 1)
      )
     )
    )
   )
   (local.set $1
    (select
     (local.tee $1
      (i32.div_s
       (local.get $3)
       (i32.const 2)
      )
     )
     (i32.const 0)
     (i32.gt_s
      (local.get $1)
      (i32.const 0)
     )
    )
   )
   (local.set $2
    (i32.add
     (i32.add
      (local.get $3)
      (local.get $4)
     )
     (i32.const 3)
    )
   )
   (local.set $5
    (i32.add
     (local.get $4)
     (i32.const 4)
    )
   )
   (loop $label1
    (if
     (local.get $1)
     (then
      (local.set $6
       (i32.load8_u
        (local.get $5)
       )
      )
      (i32.store8
       (local.get $5)
       (i32.load8_u
        (local.get $2)
       )
      )
      (i32.store8
       (local.get $2)
       (local.get $6)
      )
      (local.set $1
       (i32.sub
        (local.get $1)
        (i32.const 1)
       )
      )
      (local.set $2
       (i32.sub
        (local.get $2)
        (i32.const 1)
       )
      )
      (local.set $5
       (i32.add
        (local.get $5)
        (i32.const 1)
       )
      )
      (br $label1)
     )
     (else
      (local.set $2
       (i32.const 0)
      )
      (loop $label2
       (br_if $block
        (i32.eq
         (local.get $2)
         (local.get $3)
        )
       )
       (i32.store8
        (i32.add
         (local.get $0)
         (local.get $2)
        )
        (i32.load8_u
         (i32.add
          (i32.add
           (local.get $4)
           (i32.const 4)
          )
          (local.get $2)
         )
        )
       )
       (local.set $2
        (i32.add
         (local.get $2)
         (i32.const 1)
        )
       )
       (br $label2)
      )
      (unreachable)
     )
    )
    (unreachable)
   )
   (unreachable)
  )
  (local.get $3)
 )
 ;; custom section "producers", size 108
 ;; features section: mutable-globals, nontrapping-float-to-int, bulk-memory, sign-ext, reference-types, multivalue, bulk-memory-opt, call-indirect-overlong
)
