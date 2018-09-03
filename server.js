var http=require("http");
var express=require("express"); //외부
var bodyParser=require("body-parser"); //외부
var mysql=require("mysql");//외부 

var app=express();
var server=http.createServer(app);

app.set("view engine","ejs"); //ejs 가 views 폴더를 찾아감..
//1.확장자를 명시할 필요없고
//2.ejs 모듈로 render() 사용할 필요없음..
app.use(express.static(__dirname+"/views/"));
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json());

var pool=mysql.createPool({
	host:"localhost",
	user:"root",
	password:"",
	database:"front"
});

//리스트 요청 처리 
app.get("/reboard/list", function(request, response){
	pool.getConnection(function(error, con){
		if(error){
			console.log(error);
		}else{
			var sql="select reboard_id, writer, title, hit, date_format(regdate, '%Y-%m-%d') as regdate,team,step,depth from reboard order by team desc, step asc";
			con.query(sql, function(err, result, fields){
				if(err){
					console.log(err);
				}else{
					response.render("reboard/list", {
						records:result,
					});
				}
				con.release();
			});
		}
	});

	

});

//게시판 원글 등록
app.post("/reboard/regist", function(request, response){
	var writer=request.body.writer;
	var title=request.body.title;
	var content=request.body.content;

	console.log(writer, title, content);

	pool.getConnection(function(error, con){
		if(error){
			console.log(error);
		}else{
			//지금부터는 트랜잭션 시작!!
			con.beginTransaction(function(err){
				if(err){
					console.log(err);
				}else{
					var sql="insert into reboard(writer,title,content) values(?,?,?)";
					con.query(sql,[writer,title,content], function(e1, result1){
						if(e1){
							console.log(e1,"등록실패");
							con.release(); //반납!!
						}else{
							sql="update reboard set team=reboard_id where reboard_id=(select last_insert_id())";
							con.query(sql, function(e2, result2){
								if(e2){
									console.log(e2 , "트랜잭션 롤백 대상임");
									con.rollback(function(e3){
										console.log(e3);
									});
								}else{
									//두문장 모두 성공했으므로...트랜잭션 확정!!
									con.commit(function(e4){
										if(e4){
											console.log(e4);
										}else{
											//클라이언트에게 리스트 보여주기
											//클라이언트에게 지정한 url로 다시 접속하라고 명령한다
											response.redirect("/reboard/list");
										}
									});//디스크에 내려 씀!!
								}
							});
							con.release();
						}
					});
				}
			});
			
		}
	});

});

//상세보기 요청 처리 
app.get("/reboard/detail", function(request, response){
	var reboard_id=request.query.reboard_id;
	pool.getConnection(function(error, con){
		if(error){
			console.log(error);
		}else{
			var sql="select * from reboard where reboard_id=?";
			con.query(sql, [reboard_id] , function(err,result, fields){
				if(err){
					console.log(err);
				}else{
					//상세보기 ejs로 렌더링, 인수 전달..
					response.render("reboard/detail",{
						record:result[0]  /*[{}]넘길때 json 을 넘기자...*/
					});
				}
				con.release();
			});
			
		}
	});
});

//답변 폼 요청 처리 
app.use("/reboard/replyform", function(request, response){
	//상세보기 페이지가 전송한 파라미터들을 확인해보자!!!
	var team=request.body.team;
	var step=request.body.step;
	var depth=request.body.depth;

	console.log(request.body ,team, step, depth);	

	response.render("reboard/reply", {
		record:request.body //request.body 자체가  json 이므로, 그대로 넘긴다
	});
});

//답변 글 등록 ( 원글 등록 아님..)
app.post("/reboard/reply", function(request, response){
	//답변 등록에 필요한 파라미터들...
	var writer=request.body.writer;
	var title=request.body.title;
	var content=request.body.content;
	var team=parseInt(request.body.team);//내가 보고 온 글의 team
	var step=parseInt(request.body.step); //내가 보고 온 글의 step
	var depth=parseInt(request.body.depth);//내가 보고 온 글의 depth
	
	pool.getConnection(function(error, con){
		if(error){
			console.log(error);
		}else{
			//con 얻기에 성공했으므로, 트랜잭션 시작하자!!
			con.beginTransaction(function(err){
				if(err){
					console.log(err);
				}else{
					var sql="update reboard set step=step+1 where step > ? and team=?";	
					con.query(sql, [ step, team], function(e1, result1){
						if(e1){
							console.log(e1);
							con.release();
						}else{
							//답변글 등록 
							sql="insert into reboard(writer,title,content,team,step,depth)";
							sql+=" values(?,?,?,?,?,?)";
							con.query(sql,[writer,title,content,team,step+1,depth+1], function(e2, result2){
								if(e2){
									console.log(e2,"롤백 대상임!!");
									//마지막트랜잭션 commit 이후의 DML을 되돌려놓음
									con.rollback(function(e3){
									});
								}else{
									con.commit(function(e4){
										if(e4){
											console.log(e4);
										}else{
											//게시판 목록을 보여줘함..
											//즉 브라우저로 하여금 다시 접속할것을 명령
											response.redirect("/reboard/list");
										}
									});
								}
								con.release();
							});
						}
					});
				}
			});
		}
	});

});

/*삭제요청 처리  ( 업무가 2가지로 분류됨)
1.댓글이 없는 단독글 : 그냥 삭제
2.댓글이 하나라도 있다면 : 삭제가 아닌 수정...	
*/

app.post("/reboard/delete", function(request, response){
	var reboard_id=request.body.reboard_id; //삭제용
	var team=request.body.team;//삭제할지 판단용
	var step=request.body.step;//삭제할지 판단용
	
	pool.getConnection(function(error, con){
		if(error){
			console.log(error);
		}else{
			var sql="select count(step) as cnt from reboard where team=?  and step > ?";
			con.query(sql, [team, step], function(err, result, fields){
				if(err){
					console.log(err);
					con.release();
				}else{
					//count 값을 가지고 판단하자!!
					var obj=result[0];
					if(obj.cnt > 0){
						//삭제가 아닌 수정대상...
						console.log("답변이 하위에 있으므로, 수정할 대상입니다");
					}else{
						//삭제 대상
						console.log("답변이 없으므로, 지워도 됩니다");
					}
				}
			});
		}
	});	

});


server.listen(8888, function(){
	console.log("웹서버가 8888포트에서 실행중...");
});
